import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseOptions } from '../src/database-options.mjs';

test('remote PostgreSQL always verifies TLS even when URL options request weaker modes',()=>{
  for(const mode of ['require','no-verify','prefer','verify-ca']) {
    const options=databaseOptions('postgres://test:fixture@db.example.test/database?sslmode='+mode,{},{});
    assert.equal(options.ssl.rejectUnauthorized,true);
    assert.equal(new URL(options.connectionString).searchParams.has('sslmode'),false);
  }
  assert.throws(()=>databaseOptions('postgres://db.example.test/data?sslmode=disable',{},{}),/requires_verified_tls/);
  assert.throws(()=>databaseOptions('postgres://db.example.test/data',{}, {PGSSLMODE:'disable'}),/requires_verified_tls/);
  assert.equal(databaseOptions('postgres://127.0.0.1/test',{}, {PGSSLMODE:'disable'}).ssl,false);
});
test('CA configuration is explicit and cannot be disabled through overrides',()=>{
  const ca='-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----';
  const options=databaseOptions('postgres://db.example.test/data',{ssl:false},{BLOFY_DATABASE_CA:ca});
  assert.deepEqual(options.ssl,{rejectUnauthorized:true,ca});
  assert.throws(()=>databaseOptions('postgres://db.example.test/data',{}, {BLOFY_DATABASE_CA:'invalid'}),/invalid_database_ca/);
});
