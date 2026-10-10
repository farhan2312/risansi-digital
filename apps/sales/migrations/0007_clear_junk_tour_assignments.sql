-- 0007  Remove tour_assignments that point at people absent from `users`
-- (the junk test reps qwerty/rep2/manager). All 12 current assignments are
-- junk; this leaves tour_assignments empty so the new sysadmin tour-mapping
-- page starts from a clean slate. tour_assignments.rep_id holds a users.id
-- going forward (existing real rep ids == users ids).

DELETE FROM tour_assignments
WHERE rep_id NOT IN (SELECT id FROM users);
