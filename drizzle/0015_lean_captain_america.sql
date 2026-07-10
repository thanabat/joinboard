ALTER TABLE "board" ALTER COLUMN "key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "card" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_key_unique" UNIQUE("key");