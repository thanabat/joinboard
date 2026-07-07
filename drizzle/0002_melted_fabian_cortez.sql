ALTER TABLE "board" ADD COLUMN "inviteToken" text;--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_inviteToken_unique" UNIQUE("inviteToken");