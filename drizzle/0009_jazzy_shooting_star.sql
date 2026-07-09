CREATE TABLE "sprint" (
	"id" text PRIMARY KEY NOT NULL,
	"boardId" text NOT NULL,
	"name" text NOT NULL,
	"startDate" timestamp NOT NULL,
	"endDate" timestamp NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "sprintId" text;--> statement-breakpoint
ALTER TABLE "list" ADD COLUMN "isDoneList" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sprint" ADD CONSTRAINT "sprint_boardId_board_id_fk" FOREIGN KEY ("boardId") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_sprintId_sprint_id_fk" FOREIGN KEY ("sprintId") REFERENCES "public"."sprint"("id") ON DELETE set null ON UPDATE no action;