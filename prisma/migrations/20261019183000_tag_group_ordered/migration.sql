-- «انتخاب برای من»: a tag group can be a scale (شیرین ← کم‌شیرین ← تلخ, سبک ← متوسط ← سنگین). For such a
-- group the neighbour of the customer's answer counts half instead of nothing.
-- Only an addition with a default: existing groups stay as they were (not a scale).

ALTER TABLE "TagGroup" ADD COLUMN "ordered" BOOLEAN NOT NULL DEFAULT false;
