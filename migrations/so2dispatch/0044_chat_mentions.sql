-- 0044  Tagging in the SO chat. A message can tag people (@Name). Someone
-- tagged from outside the chat's two sides becomes its guest: they see the
-- whole chat between those two sides on that SO, and can reply, for good.
-- A chat is the pair of its sides, lane_a <= lane_b ('central_visibility'
-- for Central). Same statements in apps/so2dispatch/db/schema.sql.
-- Idempotent and additive.

CREATE TABLE IF NOT EXISTS order_message_mentions (
    message_id  UUID NOT NULL REFERENCES order_messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS order_message_mentions_user_idx ON order_message_mentions (user_id);

CREATE TABLE IF NOT EXISTS order_chat_guests (
    order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    lane_a      TEXT NOT NULL,
    lane_b      TEXT NOT NULL,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (order_id, lane_a, lane_b, user_id)
);
CREATE INDEX IF NOT EXISTS order_chat_guests_user_idx ON order_chat_guests (user_id, order_id);
