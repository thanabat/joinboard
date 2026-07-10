CREATE TABLE "sprintRetroItem" (
	"id" text PRIMARY KEY NOT NULL,
	"sprintId" text NOT NULL,
	"column" text NOT NULL,
	"content" text NOT NULL,
	"authorId" text NOT NULL,
	"position" double precision NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sprintRetroItem" ADD CONSTRAINT "sprintRetroItem_sprintId_sprint_id_fk" FOREIGN KEY ("sprintId") REFERENCES "public"."sprint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprintRetroItem" ADD CONSTRAINT "sprintRetroItem_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;