# Implemented features and screens

**As of 13 Nov 2026.** This is an inventory of what the app contains today. The plan, and what is still open, is in [feature-status.md](feature-status.md). Checks for that behavior are in [test-cases.md](test-cases.md). The design history, including changes that were later revised, lives in [spec.md](spec.md). API shapes are in [api.md](api.md). Push setup is in [push-notifications.md](push-notifications.md). Google sign-in setup is in [google-sign-in.md](google-sign-in.md). Cloud builds are in [eas-build.md](eas-build.md).

Where To Park is an Expo SDK 54 app (Android first, web for preview). Routes live in `app/`. The backend is Supabase: Postgres, Auth, Realtime, Storage, and RPCs. Money is Philippine pesos. Listing times and rate days use Asia/Manila. The product language is English.

A feature that depends on a database function only works after that migration has been applied to the database the app is using. The matching SQL is in `supabase/migrations/`.

## Features

- **Search:** map, place search, current location, vehicle filter, rate-type filter, distance, hide full, free parking, sort, drive-time ETA
- **Listing page:** photos, reviews, navigate, report, open chat, shortcuts
- **Reservations:** request a spot, price before submit, edit while waiting, approve, reject, cancel, driver sessions
- **Pricing:** hourly, daily, flat then hourly, monthly, default rate, days and dates, overnight, free parking, price breakdown
- **Sessions:** walk-in check-in, payments, fees, custom fees, refunds, waive balance, end session
- **Availability:** areas, spot count, Full switch, reserved and unavailable, sessions tab, reservations tab
- **Listing management:** create, edit, delete, verification, areas, rates, fee presets, staff invites, free parking
- **Messages:** inbox, chat, photos in chat, notifications, push
- **Account:** email sign-in, Google sign-in, accounts on this device, profile, saved vehicles, shortcuts, privacy policy, contact us
- **Admin:** verification queue, moderation, contact messages, push switches

## Who uses it

| Person           | How they get there                                      | What they can do                                                                                                                                       |
| ---------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Guest            | No sign-in                                              | Search, open a listing, see rates, photos, reviews and availability, navigate, send a Contact Us message                                               |
| Driver           | Any signed-in account                                   | Everything a guest can do, plus saved vehicles, shortcuts, reviews, reports, chat, and reservation requests where the listing allows them              |
| Staff            | Invited by an owner or manager and assigned to listings | Availability, walk-in check-in, sessions, payments, fees, refunds, and chat for those listings. Cannot change rates, areas, staff, or listing settings |
| Owner or manager | Creates a listing, or is invited as a manager           | Everything staff can do, plus listing details, photos, areas, rates, fee presets, overnight, reservation requests, and staff invites                   |
| Admin            | `profiles.is_admin`                                     | Publish, verify, or reject listings, moderate reports, read and delete contact messages, turn push types on or off                                    |

Operator membership roles are `owner`, `manager`, and `staff`. Admin is a profile flag, not a membership.

The sidebar (☰ on Find Parking) changes with the account. Guests see Sign in and Contact Us. Signed-in people also see My profile, Messages, Notifications, Sessions, and Saved vehicles. People with a listing or a staff membership see My listings; everyone else sees List your parking space. Admins also see Verify listings, Moderation queue, Contact messages, and Push notifications. Counts and the red attention dot come from `get_sidebar_counts`.

## Screen index

| Screen                 | Route                    | Header                 |
| ---------------------- | ------------------------ | ---------------------- |
| Find Parking           | `/search` (also `/`)     | Find Parking           |
| Sign in                | `/auth`                  | Sign in                |
| Google return          | `/oauth-callback`        | Signing in             |
| Accounts               | `/accounts`              | Accounts               |
| Profile                | `/profile`               | Profile                |
| Notifications          | `/notifications`         | Notifications          |
| Shortcuts              | `/shortcuts`             | Shortcuts              |
| Saved vehicles         | `/vehicles`              | Vehicles               |
| Privacy Policy         | `/privacy`               | Privacy Policy         |
| Contact Us             | `/contact`               | Contact Us             |
| Listing details        | `/location/[id]`         | Listing details        |
| Reserve a spot         | `/reserve/[locationId]`  | Reserve a spot         |
| Sessions               | `/sessions`              | Sessions               |
| Session (driver)       | `/sessions/[id]`         | Session                |
| Messages (one thread)  | `/chat/[locationId]`     | Messages               |
| My listings            | `/operator/listings`     | My listings            |
| Listing                | `/operator/hub/[id]`     | Listing                |
| List Your Space        | `/operator/onboarding`   | List Your Space        |
| Edit listing           | `/operator/edit/[id]`    | Edit listing           |
| Areas                  | `/operator/areas`        | Areas                  |
| Area                   | `/operator/area-edit`    | Area                   |
| Rates                  | `/operator/rates`        | Rates                  |
| New rate / Edit rate   | `/operator/rate-edit`    | Rate                   |
| Fee Presets            | `/operator/fees`         | Fee Presets            |
| Staff                  | `/operator/staff`        | Staff                  |
| Messages (inbox)       | `/operator/inbox`        | Messages               |
| Availability           | `/operator/availability` | Availability           |
| Available slots editor | `/operator/slots-editor` | Available slots editor |
| Check In               | `/staff/checkin`         | Check In               |
| Session (staff)        | `/staff/session`         | Session                |
| Edit details           | `/staff/session-edit`    | Edit details           |
| Apply payment          | `/staff/session-pay`     | Apply payment          |
| Add fee                | `/staff/session-fee`     | Add fee                |
| Verification Queue     | `/admin/verify`          | Verification Queue     |
| Moderation             | `/admin/reports`         | Moderation             |
| Contact messages       | `/admin/contact`         | Contact messages       |
| Contact message        | `/admin/contact-item`    | Contact message        |
| Push notifications     | `/admin/push`            | Push notifications     |

Opening a screen from a link with no back history still shows Back. It goes to that screen's parent (`src/lib/backFallback.ts`) instead of leaving the app.

## Finding parking

**Find Parking** (`/search`) is the home screen. A map shows listing pins. A bottom sheet lists the same results in three heights: Minimized, Normal, and Maximized. A new search opens Normal. Place search uses Photon. The ◎ button uses the device location. Tapping a result opens Listing details.

After a new area search, the map zooms out around the search centre when a result pin is off the map. If every pin is already on screen, the camera stays where it is. Changing filters, sort, or a live availability refresh does not move the map.

On Android, with no screen to go back to, the hardware back button minimizes a maximized sheet. When the sheet is already minimized, the first press shows "Press back again to close the app" and a second press within 2 seconds closes the app. A sheet at Normal uses that same prompt. If there is a screen to go back to, back navigates as usual.

Filters: vehicle (All, or the signed-in user's default vehicle to start), rate type, **Free parking**, and Show Full last, plus a distance slider. Full listings are hidden until that filter is turned on. Free parking, when on, shows only listings marked free. Sort: distance, price, rating, eta, open spots. Drive-time ETAs use OpenRouteService, with a straight-line fallback. Pins and the list show how many spots are free. A free listing's price reads Free. A listing is full when every relevant area is full.

## Listing details

**Listing details** (`/location/[id]`) is the public page for one listing. Tabs are Overview, Reviews, and Photos.

Overview shows the name, a Verified or Unverified badge, the address, who listed it, how many people are viewing, free spots, and when availability was last updated. A photo strip opens a full-screen viewer. Photos are the operator's gallery plus photos attached to reviews. Review photos are tagged "From a review". A free listing shows Free parking instead of rates, and the overnight setting is hidden.

When the listing allows reservation requests, **Reserve a spot** is shown. Otherwise the page says reservations are not allowed. **Navigate** opens the chosen maps app. **Report listing** is available after sign-in. Rates, rules, and contact follow. **Open Chat** is at the bottom and opens that listing's thread.

Owners and managers also see **Allow overnight** on this page. When it is on, a start time, an end time, and a price are required. The two times must differ and the price must be greater than 0. The window may cross midnight. Everyone else sees a short overnight line only when it is already on.

Reviews can be written by a signed-in driver, with a star rating, text, and photos. A review can be reported. The Photos tab is a grid of the same collection.

## Reservations and driver sessions

A reservation is a parking session whose start is still in the future. The listing must have **Allow reservation requests** on (set during listing creation and on Edit listing). The driver picks a saved vehicle or types one, a plate, a start, and an end. The price breakdown is shown before the request is sent. The stay is assigned to the Main area when that area accepts the vehicle, otherwise the next area that does.

**Sessions** (`/sessions`) lists the signed-in driver's sessions in sections: Waiting for approval, Approved reservations, Active, Previous, Rejected, Cancelled.

**Session** (`/sessions/[id]`) shows the place, status, plate, vehicle, start, end, and a collapsible planned price. While the request is waiting, the driver can edit it (back on Reserve a spot) or cancel it. An approved reservation can be cancelled. Cancel is a button; the slide-to-confirm control appears in a dialog after that, with **Keep it**. **Open Chat** is at the bottom and opens the listing chat.

Staff approve or reject a waiting request from the staff session screen. A pending reservation does not get Cancel, Apply payment, or Add fee until it is approved. A walk-in started by staff has no approval step and is treated as already approved. Staff can change the area of a reservation. They cannot edit its vehicle, plate, times, or rate. On the Availability Reservations tab, an approved reservation is tagged **Approved**. A waiting one is tagged **For Approval**.

Reject works like cancel: a **Reject** button, then a dialog with **Slide to reject** and **Keep it**.

## Pricing

One database function, `price_stay`, prices a stay. Session quotes, reservation quotes, walk-in quotes, and the Rates preview all call it. The Rates preview stays hourly: it does not switch a stay onto a monthly rate.

Rate types an owner or manager can save:

- **Hourly.** A price per hour.
- **Daily.** A price per day.
- **Flat then hourly.** A flat amount for the first N hours, then a succeeding hourly amount. The breakdown shows "Flat for first Nh" and "N succeeding hours".
- **Monthly.** Used when that rate is chosen. It does not price an ordinary hourly stay.

A rate can be limited to days of the week (Asia/Manila, based on the day the stay starts), an effective date range, one vehicle type, and one area. The default rate applies every day, has no dates, and cannot be deleted until another rate is made the default. Deactivating a rate that is in use moves those hours onto the rates that are in effect.

**Overnight** is not a rate row. It is a listing setting. Hours that fall inside the overnight window are left out of the hourly total. One overnight fee is added for each night the stay covers, including a window that crosses midnight. A monthly stay is unchanged. The breakdown line reads "Overnight: 1 night". If every hour is inside the window, the quote is the overnight fee only.

**Free parking** is a listing setting, not a rate. The switch is on the Rates screen. While it is on, a stay is ₱0 and the breakdown says Free. Overnight and saved rates are not used for the price. The rate list stays available.

## Walk-in sessions and money

**Check In** (`/staff/checkin`) starts a walk-in: area, vehicle, plate, start (now by default), optional end, and a rate (Automatic or a chosen rate). The planned price is shown before save. One plate can have only one open session at a listing. If the area is full, or switched to Full, staff can still create the session after a confirmation. Saving returns to Availability.

**Session** (`/staff/session`) is the staff view of one session or reservation. It shows the plate, vehicle, listing, area, status, and a collapsible price calculation. Open sessions can have their details edited, a fee added, a payment applied, and the session ended. Ending with a balance still due can record that payment or, when allowed, waive the balance with a reason. A finished session that was overpaid, or a cancelled reservation that already had a payment, can record a refund. **Open Chat** is at the bottom. If the session has a driver, it opens that driver's thread. Otherwise it opens the listing chat.

**Edit details** (`/staff/session-edit`) changes vehicle, plate, times, rate, and note for an open walk-in. A reservation cannot be edited here.

**Apply payment** (`/staff/session-pay`) records cash or another method against the balance, with an optional note. It is hidden for a reservation that is still waiting for approval.

**Add fee** (`/staff/session-fee`) applies a saved fee preset, or a custom name and amount when the listing has no presets yet. A custom fee is stored as an additional charge with no preset. Waiting reservations cannot take a fee. An additional fee can be removed from the session screen while the session is open.

## Availability

Availability is counted per area, then added up for the listing.

Every listing has a **Main** area. It cannot be renamed or deleted. An area can monitor a spot count or not, and can accept all vehicle types or only some. Free spots in a monitored area are total spots minus started open sessions in that area, minus Reserved, minus Unavailable, and never below zero. Switching the area to **Full** makes drivers see zero spots. Unmonitored areas do not contribute a number. A listing is full only when every area that takes the vehicle is full. Future reservations do not take a spot until they start.

**Availability** (`/operator/availability`) picks an area. For a monitored area it shows the free count, a pencil to the slots editor, and the Full switch. For an unmonitored area it shows Available or Full. Below that, **Sessions** and **Reservations** are separate tabs. Each tab has its own plate filter. **+** opens Check In for the selected area.

**Available slots editor** (`/operator/slots-editor`) sets how many spots in that area are Reserved or Unavailable. Those counts reduce the free number. They are not named parking bays.

## Listing management

**My listings** (`/operator/listings`) lists the listings this account can work on, with free spots or Full, and verification state. **+ Add a listing** starts onboarding. A rejected listing can be resubmitted.

**List Your Space** (`/operator/onboarding`) collects the name, map pin, rules, a photo, areas, and whether reservation requests are allowed, then submits the listing for verification. The address is optional and sits on the pin step. A blank address is taken from the pinned place. **Free parking** is on the capacity step. When it is on, the rate fields and the cash-payment note are hidden and a rate is not required. Capacity is still required. A new listing stays hidden until an admin publishes it. Place search and ◎ sit on the pin map. Dragging the map pans the map rather than the form.

**Listing** (`/operator/hub/[id]`) is the operator home for one listing. Owners and managers see Availability, Edit details and photos, Areas, Rates, Fee presets, and Staff. A free listing hides Fee presets. Rates stays available. Staff see Availability and Messages. Everyone who can open the hub can view the public page. Owners and managers can delete the listing by sliding to confirm. Delete is refused while sessions are still open, and the dialog offers a way back to Availability.

**Edit listing** (`/operator/edit/[id]`) changes the name, pin, optional address, rules, photos, and the reservation-requests switch. The address field is on the pin picker. A blank address is taken from the pinned place. Spot capacity is not edited here. **Manage areas** opens Areas. Free parking is set on Rates.

**Areas** (`/operator/areas`) lists areas and adds one. Delete asks first. Main has no delete.

**Area** (`/operator/area-edit`) sets the name (read-only for Main), whether spots are monitored, the total when they are, and the vehicle types. No types selected means every type.

**Rates** (`/operator/rates`) has the Free parking switch, a price preview for a sample stay, then the rate list. Each row can be edited, activated, deactivated, archived, restored, or set as the default. The preview uses the same price function as a real stay, including a flat-rate split and an overnight line when the sample hours fall in the window.

**New rate / Edit rate** (`/operator/rate-edit`) is the rate form: type, amounts, optional vehicle, days of the week, and effective dates. Saving returns to the list.

**Fee Presets** (`/operator/fees`) are named extra charges (for example a lost ticket) that staff can apply to a session.

**Staff** (`/operator/staff`) invites by email or phone. The screen never says whether that account already exists. An existing account is not added immediately. They get a notification with Accept and Decline, and appear in Members only after Accept. Resend waits three minutes. An invite can assign the person to specific listings.

## Chat and notifications

**Messages** (`/operator/inbox`) is the thread list: conversations as a driver, and, for staff, driver threads on their listings. A row shows the latest message and an unread mark. Opening a row goes to **Messages** (`/chat/[locationId]`). A `driverId` query opens that driver's thread. The thread is text plus a photo. Photos use a signed URL.

**Notifications** (`/notifications`) lists the latest notifications. Tapping one marks it read and opens the related screen: a reservation request opens the staff session, a decision opens the driver's session, a chat opens the thread, a listing review opens the listing, a staff invite stays here so it can be accepted or declined, and admin items open the matching admin screen. Unknown types stay on the list.

Push is Android, through Expo and FCM. The app registers this device's token after sign-in. Sending is done by the `send-push` edge function. Admins can turn each push type off without stopping the in-app notification. A new chat message is pushed without an in-app notification row. Tapping a push uses the same destinations as the list.

## Account

**Sign in** (`/auth`) is email and password, create account or sign in, and Google. Phone OTP is in the screen and turned off unless `PHONE_SIGN_IN_ENABLED` is on. After Google, a new account finishes a display name. A `next` parameter returns the person to the page they were trying to open.

**Accounts** (`/accounts`) keeps accounts saved on this device. Switch, add, sign out one account, or continue as a guest.

**Profile** (`/profile`) sets the display name and photo, shows the phone when there is one, and can link Google. The photo is used in chat and reviews.

**Saved vehicles** (`/vehicles`) stores a vehicle type, plate, and optional nickname. One vehicle is the default. Search starts on that type, and Reserve a spot can pick it.

**Shortcuts** (`/shortcuts`) are the signed-in user's saved listings. On Listing details, **Add shortcut** saves the listing. The shortcuts screen reorders them by holding a row and dragging, and delete asks first. Signing in can merge shortcuts that were saved on the device before the account existed.

**Privacy Policy** (`/privacy`) is public.

**Contact Us** (`/contact`) is public. Category is Issue, Feedback, or Suggestion, with a message and up to five images. A reply email or phone is optional. Guests are remembered on the device so the same person is not treated as a new sender every time.

## Admin

**Verification Queue** (`/admin/verify`) lists listings waiting for verification. An admin can open the page, publish it without verifying it, verify it, or reject it with a reason. Publishing makes it visible in search and leaves it Unverified. Verifying also publishes it. Rejecting hides it. The operator is notified.

**Moderation** (`/admin/reports`) acts on reports of listings and reviews: resolve, hide, or dismiss.

**Contact messages** (`/admin/contact` and `/admin/contact-item`) lists Contact Us submissions. An admin can open one and delete it. Images must be cleared before the message itself is deleted.

**Push notifications** (`/admin/push`) is one switch per notification type. Turning a switch off skips the phone push. The in-app notification is still created.
