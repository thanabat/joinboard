CREATE TABLE "cardLink" (
	"id" text PRIMARY KEY NOT NULL,
	"cardId" text NOT NULL,
	"linkedCardId" text NOT NULL,
	"type" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cardLink" ADD CONSTRAINT "cardLink_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cardLink" ADD CONSTRAINT "cardLink_linkedCardId_card_id_fk" FOREIGN KEY ("linkedCardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;