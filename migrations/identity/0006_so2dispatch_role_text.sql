-- 0006  SO to Dispatch's roles, as that team actually describes them.
--
-- 0002 took the labels from the portal's own ROLE_LABELS and 0005 inferred
-- two more from the data. Both were guesses from outside the app. These came
-- from Farhan on 12 Oct and replace them: "Order Making PO" and "Order Making
-- SO" are a real pair rather than a role and a variant of it, "Rep" is
-- read-only and scoped to their own SOs, and the order is the one that team
-- thinks in.
--
-- The descriptions are the point of this table. They are what an approver
-- reads at the moment of deciding, and until now two of them told the reader
-- to go and ask somebody.
UPDATE identity.app_roles SET label = v.label, description = v.description, sort_order = v.n
  FROM (VALUES
    ('admin', 'Admin', 'Everything Central Visibility does, plus managing users.', 1),
    ('central_visibility', 'Central Visibility', 'Sees and edits every SO and every department, and owns the order details.', 2),
    ('rep', 'Rep', 'Sees what Central Visibility sees, read-only, and only for their own SOs. Can chat.', 3),
    ('order_making', 'Order Making PO', 'Creates SOs and fills in the Client, Purchase Order and Sales Order details. Assigns SO details to SO members.', 4),
    ('order_making_so', 'Order Making SO', 'Fills in the Sales Order details of the SOs assigned to them.', 5),
    ('operations', 'Billing & Operations', 'Payment terms and PIs — the Billing queue.', 6),
    ('accounts', 'Accounts', 'Payments against each PI or term, and the Accounts hold.', 7),
    ('drawing', 'Drawing', 'Drawings and revisions, for the pump.', 8),
    ('purchase', 'Purchase', 'Bought-out items, for the pump.', 9),
    ('qc', 'Quality', 'QC documents, for the pump.', 10),
    ('planning', 'Planning', 'Readiness status and dates, and the readiness lots.', 11),
    ('assembly', 'Assembly & Packing', 'Packing status and packing slips.', 12),
    ('dispatch', 'Dispatch', 'Invoice and challan, dispatch, and the Docket & LR for each packing slip.', 13)
  ) AS v(role, label, description, n)
 WHERE identity.app_roles.app_slug = 'so2dispatch' AND identity.app_roles.role = v.role;
