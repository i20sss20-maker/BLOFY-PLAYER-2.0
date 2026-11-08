import test from 'node:test';
import assert from 'node:assert/strict';
import {liveDiagnosticTimeoutMs} from '../src/xtream-live-probe-budget.mjs';

test('first live sample is allowed up to 9 seconds, not the old 4.5-second cutoff',()=>{
 assert.equal(liveDiagnosticTimeoutMs(11500),9000);
 assert.equal(liveDiagnosticTimeoutMs(10300),9000);
 assert.equal(liveDiagnosticTimeoutMs(9000),8000);
});
test('later live samples are bounded by remaining global admin budget',()=>{
 assert.equal(liveDiagnosticTimeoutMs(6000),5000);
 assert.equal(liveDiagnosticTimeoutMs(2100),1200);
 assert.equal(liveDiagnosticTimeoutMs(1100),1200);
});
test('invalid time input cannot create an unbounded probe',()=>{
 assert.equal(liveDiagnosticTimeoutMs(NaN),1200);
 assert.equal(liveDiagnosticTimeoutMs(Infinity),1200);
 assert.equal(liveDiagnosticTimeoutMs(-100),1200);
});
