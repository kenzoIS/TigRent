-- Version the operational rental terms without changing accepted booking
-- snapshots. New requests accept this active version; historic bookings stay
-- linked to the terms version accepted at the time of request.
update public.terms_versions
set is_active = false
where doc_type = 'rental_terms'
  and is_active;

insert into public.terms_versions (id, doc_type, version, title, content, is_sample, is_active)
values (
  'dddddddd-0000-4000-8000-000000000004',
  'rental_terms',
  2,
  'TigRent Rental Terms & Conditions',
  $terms$
TIGRENT RENTAL TERMS & CONDITIONS — VERSION 2

1. Scope and eligibility. TigRent connects verified students for academic-equipment rentals. TigRent is not an official University of Santo Tomas service. Each borrower and lender must use their own verified account and comply with campus rules.

2. Listing and request. A listing states the item, condition, daily rate, refundable deposit, late fee, dates and pickup arrangement. A request is not confirmed until the lender accepts it and the required demo checkout is completed. The final server-confirmed price and these terms are recorded with the booking.

3. Charges and deposit. The rental charge is the displayed daily rate for every calendar day from pickup through return, inclusive. The refundable deposit and any stated late fee are shown before a request is sent. Payments, refunds and payouts in this student-project demo are simulated: no real money or payment credentials are processed.

4. Pickup and return. Both parties must meet at the listing’s stated public campus pickup point or another safe public location arranged in TigRent messages. The borrower should inspect the item at pickup and return it with its listed accessories by the stated due time on the return date.

5. Care of equipment. The borrower must use the item with reasonable care, follow any listing instructions and must not lend, sell, alter or misuse it. The borrower should promptly tell the lender through TigRent messages if the item is damaged, lost, stolen or no longer usable.

6. Cancellations, late returns and disputes. The active cancellation policy shown with the booking controls cancellation outcomes. A late return may incur the listing’s stated per-day fee. Claims about damage, missing parts, late return or non-return are handled through TigRent’s in-app dispute process using the available evidence and review workflow.

7. Communication and safety. Keep arrangements in TigRent messages. Do not post phone numbers, home addresses, payment credentials or other sensitive information in listings, request notes or chat. Meet in visible public campus areas and follow UST safety rules.

8. Platform action. TigRent may pause a listing, restrict an account or review activity where there is a safety concern, a terms breach, dishonest listing information or misuse of the platform.

9. Demo status. These are the current operational terms for this TigRent prototype. They are not a substitute for legal advice and must receive institutional and legal review before real-world deployment.
$terms$,
  true,
  true
)
on conflict (doc_type, version) do update
set title = excluded.title,
    content = excluded.content,
    is_sample = excluded.is_sample,
    is_active = excluded.is_active;
