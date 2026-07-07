CREATE TABLE "cardMember" (
	"cardId" text NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "cardMember_cardId_userId_pk" PRIMARY KEY("cardId","userId")
);
--> statement-breakpoint
ALTER TABLE "cardMember" ADD CONSTRAINT "cardMember_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cardMember" ADD CONSTRAINT "cardMember_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;