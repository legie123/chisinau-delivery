# Recon map: Bolt Food (iOS / Android customer app, courier app, merchant app + portal)

Scope: the three-sided food marketplace: customer ordering loop, courier delivery loop, merchant order + menu loop. Bolt Market (grocery) is a separate, cuttable section (priority `could`).
For: a clean-room parity target for an existing food-delivery platform in Chisinau, Moldova.
Date: 2026-10-11
Method: replica-recon, public sources only. No login, no JS bundles, no network logs, no screenshots downloaded. Short quotes are evidence only.
Marks: VERIFICAT (stated by a public page) / PROBABIL (inferred from several pages) / NEVERIFICAT (guess, not in any public source).

## Sources

| # | source | URL | what it gave |
| --- | --- | --- | --- |
| 1 | App Store, Bolt Food (customer) | https://apps.apple.com/app/id1451492388 | feature list: tracking, scheduled, pickup, Apple/Google Pay, Market, Plus, DineOut; v1.120; 4.6/5, 9.5K ratings |
| 2 | App Store, Bolt Merchant | https://apps.apple.com/app/id1576847801 | merchant app = order management, single tablet or many devices, sign-up via partners.food.bolt.eu; v3.6.0; scheduled time on printed receipts |
| 3 | App Store, Bolt Food Courier | https://apps.apple.com/app/id1470629849 | car/bike/scooter/motorbike, weekly cash-out, navigation+earnings+tips in one app, "Always" location complaint |
| 4 | Marketing page Bolt Food | https://bolt.eu/en/food/ | Recommended section, cash/card/Bolt balance, pickup, FAQ on filters, three merchant promos |
| 5 | Courier recruitment | https://bolt.eu/en/food/courier/ | requirements, 4 onboarding steps, earning model, upfront earnings |
| 6 | Courier earnings | https://bolt.eu/en/food/courier/earn/ | peak/zonal multipliers, surge, waiting-time pay, Mon-Sun cycle, tips 100% |
| 7 | Merchant recruitment | https://bolt.eu/en/food/merchant/ | 3 steps, requirements, portal analytics, sponsored listings, targeted promos |
| 8 | Support: place an order | https://bolt.eu/en-at/support/articles/360007190180/ | core ordering steps, no cancel/amend after confirm |
| 9 | Support: schedule a delivery | https://bolt.eu/en/support/articles/360007268239/ | Basket > Delivery options > Schedule > slot > Confirm |
| 10 | Support: track delivery | https://bolt.eu/en/support/articles/360007191740/ | map only after pickup |
| 11 | Support: order status | https://bolt.eu/en/support/articles/360007191560/ | 4 status stages, Order tab, "Active order" |
| 12 | Support: PIN code delivery | https://bolt.eu/en/support/articles/14158/ | PIN under ETA, no contactless |
| 13 | Support: multiple restaurants | https://bolt.eu/en/support/articles/360021496759/ | one venue per cart, parallel orders |
| 14 | Support: rate an order | https://bolt.eu/en/support/articles/360021490979/ | courier thumbs, food emoji scale, no edit |
| 15 | Support: reorder | https://bolt.eu/en/support/articles/360021472220/ | Activity tab > Order again |
| 16 | Support: order history | https://bolt.eu/en/support/articles/360016241760/ | Activity list, per-order help |
| 17 | Support: add payment method | https://bolt.eu/en/support/articles/360007248759/ | cash (some markets), Bolt balance, card; validation hold up to 14 days |
| 18 | Support: add/remove items | https://bolt.eu/en/support/articles/360008784599/ | item sheet, + / -, swipe left, pencil, bin |
| 19 | Support: search | https://bolt.eu/en/support/articles/360007268119/ | main search = restaurant names only; menu search inside venue |
| 20 | Support: price calculation | https://bolt.eu/en/support/articles/360007249339/ | delivery fee (geo), small order fee, service fee |
| 21 | Support: promotions | https://bolt.eu/en/support/articles/360021470840/ | BOGO, % menu, item-level, free delivery; auto-applied; ride codes not valid |
| 22 | Promo codes page | https://bolt.eu/en/promo/food/ | "Add promo code" at checkout, one per order, service fee excluded |
| 23 | Support: delivery information | https://bolt.eu/en/support/articles/360007190060/ | courier unreachable 5 min = may cancel + charge full value; address change via Support |
| 24 | Support: Bolt Balance | https://bolt.eu/en/support/articles/360014708880/ | virtual wallet, refunds in, negative balance from failed cash |
| 25 | Support: card payments | https://bolt.eu/en/support/articles/360021470740/ | card charged after delivery |
| 26 | Support: add a tip | https://bolt.eu/en/support/articles/6668745612946/ | checkout tip, card/balance only, revoke via Support to balance |
| 27 | Support: contact support | https://bolt.eu/en/support/articles/4402862523666/ | callback or chat, three entry points, one open case per order |
| 28 | Support: pickup | https://bolt.eu/en/support/articles/360019653079/ | collect within 90 min, pickup orders cannot be rated |
| 29 | Support: delayed order | https://bolt.eu/en/support/articles/360007269539/ | ETA after restaurant confirms |
| 30 | Support: food quality problem | https://bolt.eu/en/support/articles/360007268739/ | route = rating option (flow detail not public) |
| 31 | Support: courier problem | https://bolt.eu/en/support/articles/360007212560/ | route = Support in app |
| 32 | Support: notes/location details | https://bolt.eu/en/support/articles/360013539400/ | apartment/floor details before confirm |
| 33 | Support index: Bolt Food (customer) | https://bolt.eu/en/support/categories/360001224900/ | full article inventory (account, issues, payments, using) |
| 34 | Support index: App and Features | https://bolt.eu/en/support/sections/360005730779/ | 19 customer article titles |
| 35 | Bolt Plus | https://bolt.eu/en/plus/ | free delivery, ride cashback, first month free, cancel rules |
| 36 | Support index: Couriers | https://bolt.eu/en/support/categories/360001224880/ | courier article inventory |
| 37 | Support: accept a delivery request | https://bolt.eu/en/support/articles/360007264079/ | offer card contents, 1-minute timer |
| 38 | Support: completing delivery | https://bolt.eu/en/support/articles/4402091513618/ | handover, cash, checkboxes, rate, Delivered |
| 39 | Support: multiple drop-off | https://bolt.eu/en/support/articles/360012884220/ | batching, trip planner |
| 40 | Support: courier cancel/unassign | https://bolt.eu/en/support/articles/5471656782354/ | unassign via Get help / Report issue / Decline, limit exists |
| 41 | Support: age verification (courier) | https://bolt.eu/en/support/articles/360020738859/ | ID check block before Delivered |
| 42 | Support: get more deliveries | https://bolt.eu/en/support/articles/360009472960/ | radius by vehicle, delivery preferences |
| 43 | Support index: Restaurants | https://bolt.eu/en/support/categories/360001224920/ | merchant article inventory |
| 44 | Support: Merchant Portal | https://bolt.eu/en/support/articles/360020641760/ | availability states, hours, reports, CSV, invoices |
| 45 | Support: accept an order | https://bolt.eu/en/support/articles/360007291039/ | sound + green New orders screen, Accept, Help |
| 46 | Support: fees (merchant) | https://bolt.eu/en/support/articles/4402863195282/ | agency fee + marketplace fee (calc not public) |
| 47 | Support: own delivery | https://bolt.eu/en/support/articles/5600965685906/ | Ready For Pickup / Picked up / Delivered buttons |
| 48 | Support: add a menu item | https://bolt.eu/en/support/articles/4405236172050/ | item fields, tags, image 1280x640 |
| 49 | Support: activate promotions | https://bolt.eu/en/support/articles/8961767904018/ | manual vs automatic campaigns, 3 items, 1 week to 30 days |
| 50 | Merchant app training guide | https://bolt.eu/en-at/driver/guide/madli-test-1/ | merchant app screens, reject reasons, busy mode (URL slug looks like a test page: medium trust) |
| 51 | Merchant Portal + Menu Editor Guide 2025/26 (public PDF) | https://static.food.bolt.eu/menuEditorGuideline/6Pd8i2UyV4nXUD4tJhWTD/EN%20Bolt%20Food%20Merchant%20Portal%20+%20Menu%20Editor%20Guide%202025_2026.pdf | portal sections, menu editor tabs, modifier group types, publish flow, disputes |
| 52 | Public API docs (search snippets only; page is JS-rendered and was not readable) | https://developer.bolt.eu/food/main/ | order_state enum, order_type, order_dispatch_type, reject reasons |
| 53 | Public API changelog | https://developer.bolt.eu/changelog | DELIVERY / PICKUP / OWN_DELIVERY semantics (search snippet) |
| 54 | Bolt Market | https://bolt.eu/en/food/market/ | 3,500+ products, ~30 min, same-day cutoff, picking-to-delivery tracking |
| 55 | Support: DineOut | https://bolt.eu/en/support/articles/27440/ | dine-in discount, pay in app (search snippet) |
| 56 | Support: availability | https://bolt.eu/en/support/articles/360021486019/ | no country list; Moldova not mentioned |
| 57 | Web ordering | https://food.bolt.eu/ | title only readable; content JS-rendered, NOT confirmed |
| 59 | Early cashout news (search snippet only, page not opened) | https://www.citinewsroom.com/2024/11/bolt-food-introduces-early-cashout-feature-enabling-couriers-to-access-earnings-in-just-two-days/ | early cashout requested from Balance, up to two business days |
| 58 | Partner sign-up / portal login (not opened) | https://partners.food.bolt.eu/ , https://foodpartner.bolt.eu/login | referenced by #2 and #44; login not touched |

Screenshots: none downloaded. Reference-only candidates: the store listings #1, #2, #3 carry screenshot galleries (no captions were readable); the PDF #51 is a slide deck with UI captures.

## Core loop

Customer sets an address, picks one venue, builds a basket with options, pays (card, cash or wallet), the venue accepts and cooks, a courier collects and delivers, the customer rates; the money then splits into venue payout, courier payout and Bolt fees.

## Screens

State legend: E empty, L loading, F filled, X error, O offline, P permission. A state without `(src)` is a PROBABIL/NEVERIFICAT build assumption, not seen in a public source.

### Customer app

| ID | screen | route / how to reach | purpose | key components | states |
| --- | --- | --- | --- | --- | --- |
| S01 | Sign-in / onboarding | first launch | identify user (phone-based auth NEVERIFICAT) | phone input, OTP, language | X wrong code; P push+location prompts |
| S02 | Address picker | home header, checkout | set delivery location | search field, map, draggable pin, saved addresses | E no saved addresses; P location denied; X outside service area |
| S03 | Home / discovery | tab after S02 | browse venues | Recommended section (src #4), categories, promo banners, filter button next to search, Market and DineOut entries | L skeleton; E no venues at address; X; O |
| S04 | Search | magnifier on S03 | find venue by name only (src #19) | text field, result list | E no match |
| S05 | Filter sheet | filter button | narrow list: cuisine, price range, discount deals, ratings (src #4) | chips, range, apply/reset | E zero results |
| S06 | Venue page | tap venue | menu browsing | header (rating, ETA, fees), category tabs, item cards, in-menu search (src #19), Plus logo (src #35), View basket banner (src #8) | closed (can still schedule, src #9); item sold out; L; X |
| S07 | Item sheet | tap item | choose options | modifier groups (single/multi), quantity +/- , note for kitchen, Add to basket (src #18) | validation: required group unmet; sold out |
| S08 | Basket | View basket banner | review | line items (edit / swipe left / pencil / bin, src #18), venue note, delivery method, fee lines, minimum-order warning (src #20) | E empty; below minimum (small order fee, src #20) |
| S09 | Delivery options + schedule | Basket | Delivery / Pickup / Schedule | method radio, slot picker (src #9) | no slots; pickup unavailable at venue (src #8) |
| S10 | Checkout | Basket > checkout | final pay | address pin and exact entrance (src #8), apartment/floor details (src #32), payment selector, tip (src #26), promo code row (src #22), total with fees | X payment declined (src #25); X address out of zone; promo invalid |
| S11 | Payments | profile > Payments | manage methods and balance | card list, Bolt Balance (src #17, #24), add/remove | E no card |
| S12 | Add card | S11 | tokenize card | card form, Continue; validation hold note (src #17) | X "I can't add my card" (article exists, src #34) |
| S13 | Promo code entry | S10 | apply code | text field, confirm | X expired / not eligible (src #22) |
| S14 | Active order status | Order tab, "Active order" (src #11) | show stage | 4 stages: waiting to be confirmed, being prepared, ready for delivery, handed to delivery partner (src #11); ETA after venue confirms (src #29); PIN under ETA (src #12); call courier | L waiting; X venue rejected / failed (PROBABIL from API enum #52) |
| S15 | Live tracking | Expand on S14 | courier map, only after pickup (src #10) | map, courier marker, call button, "courier has another order" notice (src #10) | not-yet-available; stalled courier |
| S16 | Rate order | after delivery | feedback | courier thumbs up/down, food emoji scale, comment (src #14) | no edit after submit (src #14); not available for pickup (src #28) |
| S17 | Activity (order history) | Activity tab | past orders | list, order-again circle-arrow (src #15), per-order Help (src #16) | E no orders |
| S18 | Order detail | tap row in S17 | detail, receipt data, tip shown (src #26), reorder, help | items, totals, tip line | -- |
| S19 | Support: callback / chat | Help from order card, history or menu (src #27) | resolve order issue | one open case per order (src #27), callback, chat | existing chat re-opened (src #27) |
| S20 | Help center | menu > Help | FAQ + contact | categories (src #33) | -- |
| S21 | Profile / account | profile icon | settings | personal info edit, language (src #34), payments, delete account / delete history / data access (src #33) | -- |
| S22 | Bolt Plus | banner / menu | subscribe | benefits, first month free, cancel (src #35) | trial; active; cancelled-until-period-end |
| S23 | Pickup order status | after pickup order | collect | estimated collection time, venue address, 90-minute rule (src #28) | late; expired |
| S24 | Referral (Invite a friend) | menu | referral bonus (src #22) | code share | NEVERIFICAT flow |
| S25 | DineOut tab | home tab | free tables + dine-in discount, pay in app (src #55) | list, reservation, pay | NEVERIFICAT beyond summary |

### Bolt Market (separate section, priority could)

| ID | screen | route / how to reach | purpose | key components | states |
| --- | --- | --- | --- | --- | --- |
| S26 | Market entry / store select | home entry | choose nearest store (src #54) | store card, availability by address | E not available at address (src #54) |
| S27 | Market store + product list | S26 | grocery browse | category tree, product grid, search | out of stock |
| S28 | Market order tracking | after checkout | "from picking to delivery" (src #54) | picking status, courier map | picking stage |

### Courier app

| ID | screen | route / how to reach | purpose | key components | states |
| --- | --- | --- | --- | --- | --- |
| S29 | Courier registration | download or bolt.eu/en/food/courier | create account: name, city, phone (src #5) | form, vehicle choice | X duplicate/blocked account (src #5) |
| S30 | Documents + verification | after S29 | upload ID, vehicle docs (src #5) | upload, status | pending (days, src #5); rejected |
| S31 | Delivery kit | after approval | bag + gear instructions (src #5) | instructions screen | -- |
| S32 | Home / map "Waiting for orders" | app open | go online, see where demand is (src #5) | online/offline switch, map, peak-area hints (src #5), status "Waiting for orders" (src #38) | offline; P always-on location (src #3 review) |
| S33 | Order offer | push to courier | accept or decline within 1 minute (src #37) | GPS pin, pickup pin, pickup ETA, venue name and address (src #37), earnings shown before accept (src #5) | timer expiry |
| S34 | Go to venue | after accept | navigate, pickup | route, "running late" (src #36), "can't find restaurant" (src #36) | -- |
| S35 | Pickup / order check | at venue | confirm collected | status updates held until all orders ready for batches (src #39), "delivered wrong order" path (src #36) | multi-order |
| S36 | Go to customer | after pickup | navigate, instructions | delivery instructions (src #36), customer call, "can't find delivery location" (src #36) | -- |
| S37 | Handover | at customer | finish | age-check block (src #41), PIN entry (PROBABIL, src #12), cash collect, checkboxes, rate delivery, Delivered (src #38), hazard icon (src #38) | ID refused; customer unreachable 5 min (src #23) |
| S38 | Multi-drop trip planner | batched orders | route several drops (src #39) | ordered stops | -- |
| S39 | Earnings / balance | menu | see earnings, cash out | weekly totals (Mon-Sun, src #6), early cashout (src #59), tips, negative balance pay (src #36) | negative balance |
| S40 | Delivery history | menu | past deliveries (src #36) | list | E |
| S41 | Delivery preferences | menu | opt in to cash orders, ID-check orders (src #42) | toggles | -- |
| S42 | Help / report issue / unassign | in-delivery | escalate (src #40) | Get help, Report issue, Decline order | unassign limit reached (src #40) |

### Merchant tablet app

| ID | screen | route / how to reach | purpose | key components | states |
| --- | --- | --- | --- | --- | --- |
| S43 | Merchant app sign-in | app launch | auth with Bolt-registered account | email/password (NEVERIFICAT exact method) | X |
| S44 | Main | after sign-in | overview | restaurant name, Menu, Order history, Settings, Help, online/offline, active orders sidebar (src #50) | offline red bar (src #50); E no orders |
| S45 | New order alert | incoming order | draw attention | sound, green "New orders" screen (src #45) | missed -> fails at max_acceptance_ts (src #52) |
| S46 | Order detail | tap order | accept or change | order number, customer and courier info, prep countdown, total, ETA of courier, Print / Accept / Other (src #50) | locked after accept: no change/cancel (src #50) |
| S47 | Reject / change time | "Other" | reject reasons: too many orders, device issue, closed, out-of-stock items (src #50); change cooking time | picker | -- |
| S48 | Ready for pickup | after accept | tell courier food is ready (src #50) | button, courier details once assigned | own-delivery variant: Ready For Pickup / Picked up / Delivered (src #47) |
| S49 | Scheduled order start | purple "1" badge | begin prep at the right time (src #50) | Start preparation | -- |
| S50 | Menu availability | Menu button | mark items available / unavailable (src #50); sold out >14 days auto-hidden (src #50) | item list toggles | -- |
| S51 | Busy mode | settings/menu | add 15 / 30 / 45 min to cooking time, notify customers (src #50) | selector | -- |
| S52 | Order history (30 days) | menu | past orders, cash highlighted (src #50) | list | E |
| S53 | Printer / device settings | Settings | Sunmi printing, receipt (src #50, #2) | print config | printer fault (article exists, src #43) |

### Merchant portal (web)

| ID | screen | route / how to reach | purpose | key components | states |
| --- | --- | --- | --- | --- | --- |
| S54 | Portal login / activate | foodpartner.bolt.eu/login | access (src #44, #51) | email, "Request new password" | X |
| S55 | Home | after login | KPIs: sales, promotion spend, orders, average rating; irregularity cards (ratings, refunds, cancelled/unaccepted, online availability, prep time, menu completion, missing/incorrect items) (src #51) | chart, metric picker, date range | L |
| S56 | Venue selector / add venue | top-left | multi-location (src #51) | dropdown, "Add a new venue" | -- |
| S57 | Performance | nav | Sales tab (conversion, AOV, volume, total) and Operations tab (online availability, unfulfilled, delay rate, complaints) (src #51) | charts | -- |
| S58 | Promotions | nav | Smart promotions (audience targeting, cost shared with Bolt), regular discounts (src #51), manual and automatic campaigns (src #49) | campaign list/report | -- |
| S59 | Menu editor: My menu | Menu editor tab | categories + items tree, translations (src #51) | + Category, drag items | draft vs published |
| S60 | Menu editor: Items | tab | item CRUD, bulk edit price (amount or %), tags, delete (src #51) | form, bulk bar | -- |
| S61 | Menu editor: Modifiers | tab | modifier groups: single choice (min 2 options, one free) or multi choice with Max. Item (src #51) | group form | validation |
| S62 | Menu editor: Item availability | tab | Available / Sold out today / Sold out indefinitely / Hidden (src #44) | dropdown | -- |
| S63 | Menu editor: Timetables | tab | named availability windows e.g. breakfast (src #51) | day grid | -- |
| S64 | Menu editor: Menu history, Deposits | tabs | history of published menus; bottle deposits (src #51) | list | -- |
| S65 | Publish menu | My menu > Publish | draft to live, immediate or scheduled, pick venues (src #51) | wizard 4 steps | -- |
| S66 | Order history | nav | sold, earned, ratings, income by period (src #51) | table, date filter | -- |
| S67 | Ratings and feedback | nav | filter by stars/dates, Dispute rating (src #51) | sidebar | accepted dispute drops rating from average (src #51) |
| S68 | Refunds | nav | Dispute deduction per item (src #51) | sidebar | -- |
| S69 | Reports and invoices | nav | export invoices by period, CSV item/order reports, weekly invoices (src #44, #51) | export | -- |
| S70 | Opening hours + holiday | nav | hours gate when customers can order; holiday hours (src #51) | week grid | closed |
| S71 | Settings | nav | language, business details, POS integrations (src #51) | form | -- |
| S72 | Partner sign-up site | partners.food.bolt.eu | register business, set up store profile, Bolt reviews menu, live "in a week" (src #7) | form | pending review |

### Public / platform

| ID | screen | route / how to reach | purpose | key components | states |
| --- | --- | --- | --- | --- | --- |
| S73 | Marketing + FAQ page | bolt.eu/en/food/ | acquisition (src #4) | hero, app badges, FAQ | -- |
| S74 | Web ordering | food.bolt.eu | NEVERIFICAT: public page title only; marketing page has an "Order online" button (src #4) | unknown | unknown |
| S75 | Support console (internal) | not public | agents handle cases, refunds, address changes, cancel scheduled | NEVERIFICAT, inferred from "contact Support" on 8+ articles | -- |

75 screens (S75 inferred only). Customer 25, Market 3, courier 14, merchant app 11, portal 19, public 3.

## Flows

Click counts are happy-path taps for a returning user with saved address and saved card. Counts are PROBABIL (derived from step lists in the help articles, not from a live session); treat them as targets to beat, not facts.

```
F01 Customer orders delivery (core loop)
    S03 -> S06 -> S07 -> S08 -> S10 -> S14
    clicks: tap venue(1) + tap item(1) + Add to basket(1) + View basket(1) + checkout(1) + place order(1) = 6; +1..2 if options required
    edge: venue closed (schedule only, src #9); below minimum -> small order fee (src #20);
          item sold out while in basket; card declined (src #25); address outside zone;
          one venue per cart (src #13): second venue = new order; no cancel or amend after confirm (src #8)

F02 Customer sets / changes address
    S02 -> S03 (or S10)
    clicks: 3-4 (open picker, search or pin, confirm)
    edge: location permission denied; pin not on the building (src #8 stresses entrance accuracy);
          change after order only via Support (src #23)

F03 Customer finds a venue (search + filter)
    S03 -> S04 or S05 -> S06
    clicks: 3. Search is by restaurant NAME only (src #19); filters cuisine/price/discount/rating (src #4)
    edge: zero results; dish search does not exist (src #19)

F04 Customer schedules an order
    S08 -> S09 (Schedule) -> pick slot -> Confirm -> S10 -> S14
    clicks: +3 on F01 (src #9)
    edge: venue closed still allowed (src #9); campaign active at creation time applies (src #9);
          cancel only through Support (src #9); how far ahead / slot count: UNKNOWN

F05 Customer pays and tips
    S10 (payment, tip, promo)
    clicks: 0 extra if defaults; +2 for tip; +3 for promo code (src #22)
    edge: tip only with card or balance (src #26); one promo code per order (src #22); tip revoke via Support -> balance (src #26);
          card charged after delivery (src #25); negative balance from failed cash (src #24)

F06 Customer adds a card
    S11 -> S12
    clicks: ~4 (profile, Payments, fields, Continue) (src #17)
    edge: validation hold up to 14 days (src #17); decline reasons list (src #25)

F07 Customer tracks and receives
    S14 -> S15 -> (PIN) -> S16
    clicks: 1 to open the map (src #10)
    edge: map only after pickup (src #10); stalled courier -> call (src #10); courier batching notice (src #10);
          unreachable 5 min -> courier may cancel and customer is charged (src #23); PIN orders need face-to-face (src #12)

F08 Customer rates
    S16
    clicks: 3 (thumb, emoji, submit); no edit after submit (src #14); pickup orders not ratable (src #28)

F09 Customer reorders
    S17 -> S18 -> Order again -> S08
    clicks: 3 (src #15). edge: unavailable items handling UNKNOWN

F10 Customer pickup order
    S08 (Pickup) -> S10 -> S23
    edge: only selected venues (src #8); collect within 90 min or venue may bin it and Bolt may charge (src #28)

F11 Customer reports a problem
    S17/S14 -> S18 -> Help -> S19
    clicks: 3-4; callback or chat (src #27); one case per order; food-quality route is the rating (src #30); compensation rules NOT public
    edge: refund lands in Bolt Balance (src #24, #26)

F12 Customer subscribes to Plus (could)
    S22 -> subscribe (trial) -> cancel in app >=24 h before renewal (src #35)

F13 Courier onboarding
    S29 -> S30 -> (verification, days) -> S31 -> S32
    clicks: ~10 incl. uploads. edge: documents unreadable / linked to blocked account (src #5)

F14 Courier delivers one order
    S32 -> S33 -> S34 -> S35 -> S36 -> S37 -> S32
    clicks: accept(1) + arrived/picked(2) + arrived(1) + delivered(1+checkboxes) ~ 6-8 (PROBABIL)
    edge: offer expires after 1 min (src #37); late for pickup / venue not found / customer not found (src #36);
          wrong order delivered (src #36); customer unreachable 5 min (src #23); unassign limit (src #40)

F15 Courier delivers age-restricted order
    S37 with age block (src #41). edge: ID refused or under 18 -> do not hand over, call Support

F16 Courier delivers batched orders
    S33 -> S35 (hold status until all ready) -> S38 -> S37 x N (src #39)

F17 Courier cash-out
    S39 (weekly Mon-Sun, src #6; early cashout up to 2 business days, src #59)
    edge: negative balance must be paid (src #36)

F18 Merchant receives and fulfils an order
    S45 -> S46 (Accept) -> S48 (Ready for pickup)
    clicks: 3 (src #45, #50)
    edge: not accepted by max_acceptance_ts -> FAILED "DID NOT RESPOND" (src #52); reject with 4 reasons (src #50);
          no change or cancel after accept (src #50); scheduled order waits for Start preparation (src #50)

F19 Merchant edits menu and publishes
    S59/S60/S61 -> S65
    clicks: item create ~6 fields + Create; publish 4 steps (src #51, #48)
    edge: deleting category deletes its items, unrecoverable (src #51); schedule publish; multi-venue publish

F20 Merchant sells out an item
    S50 (tablet) or S62 (portal)
    edge: sold out >14 days auto-hidden (src #50); Sold out today returns next day (src #44)

F21 Merchant runs a promotion
    S58. Automatic (menu-wide %, free delivery): self-serve in portal; manual (2x1, free item, item %): menu edit + email Support;
    manual needs >=3 items and 1 week to 30 days (src #49)

F22 Merchant disputes a rating or deduction
    S67 / S68 -> Dispute with comment -> accepted: removed from average / reversed (src #51)

F23 Merchant onboarding
    S72 -> menu setup with Bolt team -> Bolt review -> live (~1 week, src #7)

F24 Own-delivery order (merchant's couriers)
    S46 tagged Own Delivery -> Ready For Pickup -> Picked up -> Delivered (src #47)
```

24 flows (F10, F12, F15, F16, F24 are variants; F23 is largely manual operations).

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button | primary, secondary, text, destructive, sticky bottom CTA (View basket banner) | default, pressed, disabled, loading | all |
| Address pin map | draggable pin, result list | permission denied, no results, outside zone | S02, S10 |
| Venue card | standard, closed, Plus-logo, promo badge, sponsored | loading skeleton | S03, S04 |
| Chip / filter | cuisine, price range, discount, rating | selected, none | S03, S05 |
| Category tab bar | sticky horizontal | active | S06, S59 |
| Item card | with photo, no photo, sold out, discounted | default, unavailable | S06, S50 |
| Modifier group | single choice (radio), multi choice (checkbox with max), counter (API enum, src #52) | required-unmet, max reached | S07, S61 |
| Quantity stepper | +/- | min | S07, S08 |
| Basket line | swipe actions, pencil, bin | -- | S08 |
| Fee breakdown | delivery, small order, service, tip, promo | -- | S08, S10 |
| Segmented control | Delivery / Pickup / Schedule | -- | S09 |
| Slot picker | day + time | no slots | S09 |
| Payment row | card, Apple/Google Pay (src #1), cash, Bolt Balance | missing, failed | S10, S11 |
| Order status stepper | 4 stages + PIN + ETA | each stage | S14 |
| Live map | courier marker, route, venue marker | not available yet, stale | S15, S32, S34, S36 |
| Rating widgets | thumbs, emoji scale, 1-5 stars (merchant filter, src #51) | submitted | S16, S67 |
| Support entry | callback, chat | existing case | S19 |
| Offer card + countdown | 60 s | expired | S33 |
| Alert screen | sound + full-screen green | acknowledged | S45 |
| Toggle (online/offline) | courier, merchant | offline bar | S32, S44 |
| Data table + CSV export | sortable, date filter | empty | S52, S56, S66, S69 |
| KPI chart tile | line / bar, metric picker | loading | S55, S57 |
| Wizard | publish (4 steps) | scheduled | S65 |
| Tag chip | spicy..halal, special offer | -- | S60 |
| Toast / banner | success, error, "courier has another order" | -- | all |
| Push notification | status change, offer, scheduled prep | permission denied | S14, S33, S49 |

## Inferred data model

Fields are mostly inferred from UI plus the public API enums; confidence marked per entity. Names are mine, not Bolt's.

```
User (customer)  id, phone, name, email, language, bolt_balance, created_at, deleted_at
                 evidence: S01, S21, support "edit personal information / delete account"
                 confidence: medium (auth method guess)
Address          id, user_id, label, lat, lng, text, entrance_notes (apartment/floor)
                 evidence: S02, S10, src #8, #32       confidence: high
PaymentMethod    id, user_id, type (card|cash|balance|apple_pay|google_pay), token, brand, last4
                 evidence: src #17, #1                 confidence: high (cash is market-specific)
BalanceEntry     id, user_id, amount (+/-), reason (refund|compensation|tip_refund|failed_payment_debt), order_id
                 evidence: src #24, #26                confidence: high
Venue            id, merchant_id, name, type (restaurant|store), lat, lng, hours, holiday_hours, rating_avg,
                 prep_time_default, busy_until, plus_eligible, accepts_pickup, accepts_scheduled, own_delivery, status
                 evidence: S06, S44, S51, src #47, #52 confidence: high
Menu             id, venue_id, status (draft|published), published_at, scheduled_publish_at; history of versions
                 evidence: S59, S64, S65               confidence: high
Category         id, menu_id, name_i18n{}, position
Item             id, name_i18n, description, price (VAT incl), image, sku, age_restricted, tags[], availability_state
                 (available|sold_out_today|sold_out_indefinitely|hidden), timetable_id, deposit_id, category_ids[]
                 evidence: src #48, #51, #44           confidence: high
ModifierGroup    id, name, type (single|multi|counter), min, max, modifiers[], item_ids[]
Modifier         id, group_id, name, price_delta
                 evidence: src #51 (single/multi), #52 (counter enum)  confidence: high
Timetable        id, venue_id, name, windows[day, from, to]            evidence: src #51   confidence: high
Deposit          id, name, amount                                       evidence: src #51   confidence: medium
Basket           id, user_id, venue_id, items[], note, delivery_method, scheduled_for, promo_code, tip
                 evidence: S08, src #13 (one venue)    confidence: high
Order            id, user_id, venue_id, courier_id?, order_type (delivery|pickup|own_delivery), dispatch_type (regular|scheduled),
                 state (CREATED|ACCEPTED|PREPARING|REJECTED|FAILED|WAITING_PICKUP|... then delivered/cancelled), 
                 pickup_ts, max_acceptance_ts, scheduled_for, address, pin_code?, payment_method_id, totals{items, delivery_fee,
                 small_order_fee, service_fee, discount, tip, total}, cash_to_collect, age_check_required, created_at
                 evidence: src #52 (state, type, dispatch, timestamps), S10, S14, src #12, #20
                 confidence: high for the API enums, medium for totals/pin
OrderItem        id, order_id, item_id, name_snapshot, qty, unit_price_snapshot, selected_modifiers[], note
OrderEvent       id, order_id, state, at, actor (customer|venue|courier|system|support)    confidence: medium (needed for S14, S66)
Delivery         id, order_id, courier_id, offered_at, accepted_at, picked_up_at, delivered_at, route_distance, batch_id?
                 evidence: src #37, #38, #39           confidence: medium
Courier          id, phone, city, vehicle (car|bike|scooter|motorbike), status (pending|active|blocked), online, location, preferences{cash, id_check}, balance
                 evidence: src #5, #42                 confidence: high
CourierDocument  id, courier_id, type, file, status (pending|ok|rejected)     evidence: src #5   confidence: medium
CourierPayout    id, courier_id, period (Mon-Sun), base, distance, time, multipliers, tips, total, paid_at, early_cashout
                 evidence: src #5, #6                  confidence: medium
Tip              id, order_id, amount, method (card|balance|cash)               evidence: src #26   confidence: high
Promotion        id, venue_id?, type (bogo|percent_menu|percent_item|free_delivery|free_item), params, start, end, funded_by (venue|bolt|shared), mode (auto|manual)
                 evidence: src #21, #49, #51           confidence: medium
PromoCode        id, code, value, scope (market|zone|venue|min_order), cap, expires, single_use_per_order
                 evidence: src #22                     confidence: medium
Rating           id, order_id, courier_thumb (up|down), food_score (emoji 1-5?), comment, disputed, dispute_status
                 evidence: src #14, #51                confidence: high (emoji scale size guess)
Refund/Deduction id, order_id, items[], amount, destination (balance|card), venue_deduction, dispute_status
                 evidence: src #24, #51                confidence: medium
SupportCase      id, order_id (unique open per order), channel (chat|callback), status, messages[]   evidence: src #27   confidence: high
Subscription     id, user_id, plan, trial_ends, renews_at, cancelled_at, country         evidence: src #35   confidence: medium
MerchantUser     id, venue_ids[], email, role                                              evidence: src #51   confidence: medium
Invoice          id, venue_id, period, orders[], fees{agency, marketplace}, vat           evidence: src #46, #51   confidence: guess on internals
Zone/City        id, polygon, delivery_fee_rules, service_fee, min_order, surge   evidence: src #20 (fee by geography)   confidence: guess
DineOutOffer     id, venue_id, discount, tables; transaction_id   evidence: src #55   confidence: guess (could)
MarketProduct    id, store_id, sku, name, price, category_tree, stock   evidence: src #54, stores API   confidence: guess (could)
```

Relationships: User 1-n Address, User 1-n PaymentMethod, User 1-n BalanceEntry, Merchant 1-n Venue, Venue 1-n Menu, Menu 1-n Category, Category n-m Item, Item n-m ModifierGroup, ModifierGroup 1-n Modifier, Venue 1-n Timetable, User 1-n Basket (one active per venue), Basket -> Order (snapshot), Order 1-n OrderItem, Order 1-n OrderEvent, Order 0..1 Delivery, Delivery n-1 Courier, Courier 1-n CourierPayout, Order 0..1 Rating, Order 0..n Refund, Order 0..n SupportCase (1 open), Venue 1-n Promotion, Venue 1-n Invoice, User 0..1 Subscription.

32 entities listed (incl. 2 cuttable: DineOutOffer, MarketProduct). A Merchant parent of Venue is implied but not listed separately.

## Feature matrix

See `features.csv` (clone = no on every row). Skip items are listed below, not in the CSV.
157 rows: must 70, should 51, could 36. By area: customer 64, merchant 37, courier 30, platform 18, market 8. `original` = `yes` when a public page states it, `unconfirmed` when assumed (14 rows, mostly gaps listed under unknowns).

## Out of scope (cannot or should not be cloned)

- skip: Bolt brand, logos, icons, app copy, illustrations, photography.
  Reason: owned IP; describe patterns only.
- skip: Bolt's rider and driver network, Bolt user base, Bolt's cross-service wallet and login (one account across rides, scooters, food). Reason: network effects, not code.
- skip: Bolt Plus economics (cross-service cashback, ride priority, free ride cancellations). Reason: needs ride/scooter business; the Food-only parts (free delivery above a minimum, capped per order) stay as `could`.
- skip: Bolt ride, scooter, e-bike, Drive, Send cross-sell and promo-code sharing with rides. Reason: other products.
- skip: Partner deals and corporate accounts (chains, Bolt for Business), account managers, DineOut discount agreements, sponsored-listing sales, smart promotions cost-sharing with Bolt. Reason: commercial relationships.
- skip: Bolt's dispatch/ETA/surge ML models and fee engine tuning. Reason: proprietary data; build a simple rule version.
- skip: Licences and regulatory: card acquiring and PCI scope, e-money for Bolt Balance, alcohol/tobacco age-restricted sales licence, courier insurance, VAT invoicing rules for Moldova. Reason: regulated; use a PSP and local counsel.
- skip: Bolt's internal support console, fraud and risk tooling, safety incident program. Reason: not public.
- skip: Merchant hardware program (Bolt-supplied tablets, Sunmi printers). Reason: logistics, optional; support printing via browser or ESC/POS later.

## Biggest unknowns (public sources could not confirm)

- Customer sign-in method, welcome screens, any onboarding permissions copy.
- Sort options (only filters found), favourites/saved venues, group order (not found: treat as non-existent; do not build on Bolt's word).
- Home page layout (category icons, carousel order, ads), venue card fields (ETA range, fee shown on card).
- Real fee values, minimum order logic, surge, courier pay formula inputs, commission percentages (support page only names "agency fee" and "marketplace fee").
- Refund and compensation rules for missing items, wrong items, cold food (the support articles route to rating or Support without rules).
- How far ahead scheduling reaches, slot length, cancellation fees.
- Dispatch rules: radius per vehicle (exists, values not public), offer ranking, batching limits, unassign limit number, decline consequences.
- Whether web ordering at food.bolt.eu supports full checkout (page content is JS-rendered, unreadable here); Google Play listing and any walkthrough videos were not read.
- Moldova availability or local payment methods; Bolt Food's own availability page does not list countries.
- Developer API docs were reachable only through search snippets (enums), not full schemas.

## Size

Screens 75, flows 24, entities 32.

Hard parts, in order:
1. Dispatch + realtime: offer/accept with timer, courier location, ETA, batching, live map, order state machine synchronised across three clients (customer, courier, merchant tablet).
2. Money: card authorization with capture after delivery, cash handling and debt, wallet (balance ledger, negative balance), tips, refunds and merchant deduction disputes, weekly courier and venue payouts, invoices with VAT.
3. Merchant menu and order operations: menu editor with draft/publish/schedule, modifiers, timetables, availability states, opening hours, promotions, plus an always-on tablet app with loud alerts, printing and auto-fail on missed acceptance.

Size: three-sided parity = XL (rescope). Customer + minimal courier + minimal merchant tablet (no portal analytics, no Plus, no Market, no DineOut) = L. The customer app alone against a stubbed backend = M.
