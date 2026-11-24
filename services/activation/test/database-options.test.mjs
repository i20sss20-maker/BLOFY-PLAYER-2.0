import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { databaseOptions, observeIdleDatabaseErrors } from '../src/database-options.mjs';

test('remote PostgreSQL always verifies TLS even when URL options request weaker modes',()=>{
  for(const mode of ['require','no-verify','prefer','verify-ca']) {
    const options=databaseOptions('postgres://test:fixture@db.example.test/database?sslmode='+mode,{},{});
    assert.equal(options.ssl.rejectUnauthorized,true);
    assert.equal(new URL(options.connectionString).searchParams.has('sslmode'),false);
  }
  assert.throws(()=>databaseOptions('postgres://db.example.test/data?sslmode=disable',{},{}),/requires_verified_tls/);
  assert.throws(()=>databaseOptions('postgres://db.example.test/data',{}, {PGSSLMODE:'disable'}),/requires_verified_tls/);
  assert.equal(databaseOptions('postgres://127.0.0.1/test',{}, {PGSSLMODE:'disable'}).ssl,false);
  assert.equal(databaseOptions('postgres://postgres:secret@Postgres.railway.internal:5432/railway',{}, {PGSSLMODE:'disable'}).ssl,false);
  assert.throws(()=>databaseOptions('postgres://evilrailway.internal.example/data',{}, {PGSSLMODE:'disable'}),/requires_verified_tls/);
});
test('CA configuration is explicit and cannot be disabled through overrides',()=>{
  const ca='-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----';
  const options=databaseOptions('postgres://db.example.test/data',{ssl:false},{BLOFY_DATABASE_CA:ca});
  assert.deepEqual(options.ssl,{rejectUnauthorized:true,ca});
  assert.throws(()=>databaseOptions('postgres://db.example.test/data',{}, {BLOFY_DATABASE_CA:'invalid'}),/invalid_database_ca/);
});

test('private Railway DB uses one per-session no-parallel-gather safety setting without a database restart',()=>{
  const target='postgres://user:secret@Postgres.railway.internal:5432/railway';
  const cfg=databaseOptions(target,{}, {PGSSLMODE:'disable'});
  assert.equal(cfg.options,'-c max_parallel_workers_per_gather=0');
  assert.equal(cfg.max,4);
  assert.equal(cfg.ssl,false);
  assert.equal(cfg.statement_timeout,10000);
  assert.equal(databaseOptions(target,{}, {PGSSLMODE:'disable',
    BLOFY_POSTGRES_PARALLEL_GATHER_SAFE_MODE:'0'}).options,undefined);
  assert.equal(databaseOptions('postgres://localhost:5432/test',{}, {PGSSLMODE:'disable'}).options,undefined);
  assert.equal(databaseOptions('postgres://db.example.test/pg',{}, {}).options,undefined);
});

test('private Railway URL options cannot silently override the DSM limit',()=>{
  const cfg=databaseOptions('postgres://Postgres.railway.internal/railway?options=-c%20max_parallel_workers_per_gather%3D8',
    {}, {PGSSLMODE:'disable'});
  assert.equal(cfg.options,'-c max_parallel_workers_per_gather=0');
  assert.equal(new URL(cfg.connectionString).searchParams.has('options'),false);
  const explicit=databaseOptions('postgres://Postgres.railway.internal/railway',
    {max:2}, {PGSSLMODE:'disable'});
  assert.equal(explicit.max,2);
  assert.equal(explicit.options,'-c max_parallel_workers_per_gather=0');
});


test('idle database socket failures are handled without crashing or exposing error details',()=>{
  const pool=new EventEmitter(),events=[];
  let now=1000;
  observeIdleDatabaseErrors(pool,{clock:()=>now,notify:event=>events.push(event)});
  const error=Object.assign(new Error('postgres://secret@private.example/customer'),{code:'57P01'});
  assert.doesNotThrow(()=>pool.emit('error',error));
  assert.deepEqual(events,[{code:'57P01',suppressed:0}]);
  now+=100;
  pool.emit('error',error);
  assert.equal(events.length,1);
  now+=30000;
  pool.emit('error',{code:'sensitive-provider-string',message:'private'});
  assert.deepEqual(events[1],{code:'idle_connection_error',suppressed:1});
  assert.doesNotMatch(JSON.stringify(events),/secret|private|sensitive/);
});
test('failure of idle database telemetry cannot crash the activation API',()=>{
  const pool=new EventEmitter();
  observeIdleDatabaseErrors(pool,{notify:()=>{throw Error('telemetry unavailable')}});
  assert.doesNotThrow(()=>pool.emit('error',new Error('connection lost')));
});
