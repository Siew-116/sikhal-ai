#!/usr/bin/env bash
# Live integration test of the fail-closed approval gate.
# Creates a case, then exercises approve/execute in the exact order a
# double-clicking user would.  Every step asserts on both the HTTP
# status and the JSON body so a 308 redirect can never masquerade as a pass.
set -u

B=http://localhost:3000
FAIL=0

pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# ---- 0. Create a case and run the agent pipeline -------------------------
# The demo payload is built from the canonical fixture by Node so the script
# always exercises the same six-customer scenario the UI's "Load sample case"
# button produces.
echo "=== STEP 0: create case + run pipeline ==="
# The order reference is suffixed with a unique per-run token so repeated runs
# exercise a fresh cancellation. The duplicate guard is deliberately NOT
# bypassed — step 7 re-posts this exact reference to prove the guard fires.
ORDER_SUFFIX="VERIFY-$$-$(date +%s)"
PAYLOAD=$(node scripts/demo-payload.mjs "$ORDER_SUFFIX")
CREATE=$(curl -s -X POST "$B/api/cases" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD")

RES=$(node -e "
  const p = JSON.parse(process.argv[1]);
  // ok() returns the raw object, so resolution sits at the top level.
  const r = p.resolution;
  if (!r) { console.error('NO RESOLUTION IN RESPONSE: ' + process.argv[1].slice(0,400)); process.exit(9); }
  console.log(r.id + ' ' + r.contentHash + ' ' + r.totalRefundSen + ' ' + (r.affected||[]).length);
" "$CREATE") || { echo "$CREATE"; exit 1; }

set -- $RES
RESID=$1; HASH=$2; TOTAL=$3; NLINES=$4
echo "  resolutionId=$RESID  hash=$HASH  totalRefundSen=$TOTAL  affected=$NLINES"

if [ "$TOTAL" = "42840" ]; then pass "total refund is RM428.40 (42840 sen)"; else fail "unexpected total: $TOTAL"; fi
if [ "$NLINES" = "6" ]; then pass "6 affected customers refunded"; else fail "unexpected affected count: $NLINES"; fi

A=$B/api/resolutions/$RESID/approve

# ---- 1. Execute before approval -> must fail closed ---------------------
echo "=== STEP 1: execute BEFORE approval (must fail closed) ==="
R=$(curl -s -w '\n%{http_code}' -X PUT "$A")
CODE=$(echo "$R" | tail -1); BODY=$(echo "$R" | sed '$d')
echo "  HTTP $CODE  $BODY"
if [ "$CODE" = "409" ]; then pass "execute blocked with 409"; else fail "expected 409, got $CODE"; fi
if echo "$BODY" | grep -qi 'approv'; then pass "error names the approval requirement"; else fail "error does not mention approval: $BODY"; fi

# ---- 2. Approve with a tampered hash -> must fail -----------------------
echo "=== STEP 2: approve with WRONG hash (must fail) ==="
R=$(curl -s -w '\n%{http_code}' -X POST "$A" -H 'Content-Type: application/json' \
  -d '{"contentHash":"deadbeef","approvedBy":"founder"}')
CODE=$(echo "$R" | tail -1); BODY=$(echo "$R" | sed '$d')
echo "  HTTP $CODE  $BODY"
if [ "$CODE" = "409" ]; then pass "tampered hash rejected with 409"; else fail "expected 409, got $CODE"; fi

# ---- 3. Approve with the correct hash -> must succeed -------------------
echo "=== STEP 3: approve with CORRECT hash (must succeed) ==="
R=$(curl -s -w '\n%{http_code}' -X POST "$A" -H 'Content-Type: application/json' \
  -d "{\"contentHash\":\"$HASH\",\"approvedBy\":\"founder\"}")
CODE=$(echo "$R" | tail -1); BODY=$(echo "$R" | sed '$d')
echo "  HTTP $CODE  $BODY"
if [ "$CODE" = "200" ]; then pass "approval accepted with 200"; else fail "expected 200, got $CODE"; fi
if echo "$BODY" | grep -q '"status":"approved"'; then pass "status is 'approved'"; else fail "status not approved: $BODY"; fi

# ---- 4. Execute after approval -> must succeed --------------------------
echo "=== STEP 4: execute AFTER approval (must succeed) ==="
R=$(curl -s -w '\n%{http_code}' -X PUT "$A")
CODE=$(echo "$R" | tail -1); BODY=$(echo "$R" | sed '$d')
echo "  HTTP $CODE  $BODY"
if [ "$CODE" = "200" ]; then pass "execution succeeded with 200"; else fail "expected 200, got $CODE"; fi
if echo "$BODY" | grep -q '"status":"executed"'; then pass "status is 'executed'"; else fail "status not executed: $BODY"; fi

# ---- 5. Repeat execute -> must refuse, and must not execute twice -------
# A second execute is expected to be REFUSED (409), not silently accepted.
# The compare-and-swap on status='approved' means the first execute moved the
# row to 'executed', so the second finds no matching row and refuses. That is
# the correct double-click safety behaviour; the test asserts it explicitly.
echo "=== STEP 5: repeat execute (must be refused, not re-executed) ==="
R=$(curl -s -w '\n%{http_code}' -X PUT "$A")
CODE=$(echo "$R" | tail -1); BODY=$(echo "$R" | sed '$d')
echo "  HTTP $CODE  $BODY"
if [ "$CODE" = "409" ]; then pass "repeat execute refused with 409"; else fail "expected 409, got $CODE"; fi
if echo "$BODY" | grep -qi 'already'; then pass "refusal explains it was already executed"; else fail "refusal message unclear: $BODY"; fi

# ---- 6. Persisted state is consistent -----------------------------------
echo "=== STEP 6: reload resolution and verify persisted state ==="
CASEID=$(node -e "
  const p = JSON.parse(process.argv[1]);
  console.log(p.case && p.case.id ? p.case.id : '');
" "$CREATE")
echo "  caseId=$CASEID"
RELOAD=$(curl -s "$B/api/cases/$CASEID")
node -e "
  const p = JSON.parse(process.argv[1]);
  const r = p.resolution;
  if (!r) { console.log('  FAIL  no resolution on reload'); process.exit(1); }
  const sum = (r.affected||[]).reduce((a,l)=>a+l.refundSen,0);
  const paid = (r.affected||[]).reduce((a,l)=>a+l.paidSen,0);
  console.log('  status=' + r.status + '  sum(refunds)=' + sum + '  total=' + r.totalRefundSen + '  executedAt=' + (r.executedAt||'null'));
  if (sum !== r.totalRefundSen) { console.log('  FAIL  invariant A1 violated: ' + sum + ' != ' + r.totalRefundSen); process.exit(1); }
  console.log('  PASS  invariant A1 holds after execution');
  if (r.status === 'executed' && r.executedAt) console.log('  PASS  status executed and executedAt recorded');
  else { console.log('  FAIL  execution not durably recorded'); process.exit(1); }
  if (paid === 42840) console.log('  PASS  total paid across customers is RM428.40');
  else { console.log('  FAIL  unexpected total paid: ' + paid); process.exit(1); }
" "$RELOAD" || FAIL=$((FAIL+1))

# ---- 7. Cross-resolution duplicate guard --------------------------------
# Re-submitting the SAME order reference must be refused: those customers have
# already been refunded for this supplier cancellation. This is the guarantee
# that a per-resolution unique constraint cannot provide.
echo "=== STEP 7: duplicate refund for the same cancellation must be refused ==="
REQ=$(node scripts/demo-payload.mjs "$ORDER_SUFFIX")
R=$(curl -s -w '\n%{http_code}' -X POST "$B/api/cases" \
  -H 'Content-Type: application/json' -d "$REQ")
CODE=$(echo "$R" | tail -1); BODY=$(echo "$R" | sed '$d')
echo "  HTTP $CODE"
echo "  $BODY" | head -c 220; echo
if [ "$CODE" = "409" ]; then
  pass "duplicate refund refused with 409 (a conflict, not a server error)"
else
  fail "expected 409, got $CODE"
fi
if echo "$BODY" | grep -qi 'already been recorded\|duplicate'; then
  pass "refusal names the duplicate"
else
  fail "refusal message unclear: $BODY"
fi

echo
if [ "$FAIL" = "0" ]; then echo "RESULT: ALL APPROVAL-GATE ASSERTIONS PASSED"; else echo "RESULT: $FAIL ASSERTION(S) FAILED"; fi
exit $FAIL