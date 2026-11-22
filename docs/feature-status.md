# Feature status

**As of 22 Nov 2026.** Planned features, and whether each one is in the app.

Add a row when a feature is planned. Status:

- 🟢 — in the app today. What it does is in [implemented.md](implemented.md).
- 🟡 — some of it is in the app.
- 🔴 — planned, not built.

Do not delete a row when it ships. Change its status. [spec.md](spec.md) is the design history, including behavior that was later revised. Checks are in [test-cases.md](test-cases.md).

## Search and map

| Status | Feature                                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟢     | Find Parking map and results sheet, no sign-in required. The first search uses the device location, and does not fall back to another place. The map ends just under the minimized sheet so the centre cursor sits in the visible map |
| 🟢     | Sheet heights Minimized, Normal, and Maximized. A new search opens Normal. Handle tap cycles the three heights                                                   |
| 🟢     | Place search (Photon) and the ◎ current-location button. Neither searches until Search this area                                                                |
| 🟢     | Distance slider follows the visible map (0.5 km up to the search limit, 50 km unless an admin changed it). A wider map shows a short toast on the map that the search was limited, with a close button, and zooms in to that limit. A new search sets the slider to that maximum; filters and sort keep the chosen value |
| 🟢     | Opening zoom 13.25                                                                                                                                               |
| 🟢     | Filters: vehicle, rate type, Free parking, Show Full last. Full listings stay hidden until Show Full is on                                                      |
| 🟢     | Sort by distance, price, rating, eta, and open spots                                                                                                             |
| 🟢     | Pins and rows show free spots. A free listing's price reads Free. Drive-time ETAs fall back to a straight-line estimate                                         |
| 🟢     | Clusters sum the free spots inside them. Tapping a cluster zooms until its pins are visible                                                                      |
| 🟢     | Live availability refresh keeps the camera and the sheet where they are                                                                                         |
| 🟢     | After a new area search, the map zooms out around the search centre only when a result pin is off screen                                                        |
| 🟢     | Each result row has Navigate, using the maps app chosen on Profile                                                                                              |
| 🟢     | Returning from Listing details keeps the camera, results, filters, sort, and sheet position                                                                    |
| 🟢     | Android hardware back on Find Parking, with nothing to go back to: a maximized sheet minimizes. Minimized or Normal uses "Press back again to close the app"   |
| 🔴     | In-app turn-by-turn navigation                                                                                                                                   |

## Listing details

| Status | Feature                                                                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 🟢     | Overview, Reviews, and Photos                                                                                                    |
| 🟢     | Verified or Unverified badge, address, who listed it, viewers, free spots, and when availability was last updated               |
| 🟢     | Photo strip and full-screen viewer. Review photos are tagged "From a review"                                                    |
| 🟢     | Free parking shows Free parking instead of rates and hides overnight                                                            |
| 🟢     | Reserve a spot only when the listing allows requests                                                                             |
| 🟢     | Navigate opens the chosen maps app at the pin                                                                                    |
| 🟢     | Report listing after sign-in. Open Chat at the bottom                                                                            |
| 🟢     | Signed-in drivers write a review with stars, text, and up to 5 photos, and can report a review                                   |
| 🟢     | Add shortcut, reorder, and delete. Guest shortcuts can merge into the account on sign-in                                         |
| 🟢     | Owners and managers edit Allow overnight (start, end, price; the window may cross midnight)                                      |
| 🔴     | Operator's public reply on a review                                                                                              |
| 🔴     | "Booked via app" on a review tied to a finished stay                                                                             |
| 🔴     | Staff rate a driver from a session                                                                                               |

## Reservations

| Status | Feature                                                                                                              |
| ------ | -------------------------------------------------------------------------------------------------------------------- |
| 🟢     | Driver requests a spot: vehicle, plate, start, end, and the price before sending                                    |
| 🟢     | The stay goes to Main when that area accepts the vehicle, otherwise the next area that does                         |
| 🟢     | Driver Sessions sections: waiting, approved, active, previous, rejected, cancelled                                  |
| 🟢     | While waiting, the driver can edit or cancel. An approved reservation can be cancelled. Cancel uses slide-to-confirm |
| 🟢     | Staff approve, or reject with slide-to-confirm. They can change the area. They cannot edit vehicle, plate, times, or rate until it is approved |
| 🟢     | A waiting reservation has no Cancel, Apply payment, or Add fee until it is approved                                 |
| 🔴     | Reservation fee and a hold that expires                                                                              |
| 🔴     | Automatic no-show release                                                                                            |

## Pricing

| Status | Feature                                                                                                                    |
| ------ | -------------------------------------------------------------------------------------------------------------------------- |
| 🟢     | One price function, `price_stay`, for session quotes, reservation quotes, walk-in quotes, and the Rates preview            |
| 🟢     | Hourly, daily, flat then hourly, and monthly. Monthly prices a stay only when that rate is chosen                          |
| 🟢     | A rate can be limited to days, dates, one vehicle type, and one area. Each billed hour uses the rate in effect then        |
| 🟢     | One default rate, always applicable, not deletable until another rate is made the default                                  |
| 🟢     | Deactivate, activate, archive, and restore. Deactivating a rate that is in use moves those hours onto the rates in effect  |
| 🟢     | Overnight is a listing setting: one fee per night, including a window that crosses midnight. A monthly stay is unchanged   |
| 🟢     | Free parking prices a stay at ₱0. The rate list stays available                                                            |

## Sessions and money

| Status | Feature                                                                                                              |
| ------ | -------------------------------------------------------------------------------------------------------------------- |
| 🟢     | Walk-in check-in: area, vehicle, plate, start, optional end, Automatic or a chosen rate, price before save          |
| 🟢     | One open session per plate per listing                                                                              |
| 🟢     | A full area, or an area switched to Full, still accepts a session after staff confirm                               |
| 🟢     | Edit details for an open walk-in. A reservation is not edited there                                                  |
| 🟢     | Apply payment (cash or another method) against the balance                                                          |
| 🟢     | Add a fee preset, or a custom fee when the listing has none. Remove an additional fee while the session is open     |
| 🟢     | End session. A remaining balance can be paid or waived with a reason. Staff can waive only when the listing allows it |
| 🟢     | Refund an overpaid ended session, or a cancelled reservation that was already paid                                  |
| 🟢     | Overdue notification when a scheduled end passes                                                                    |
| 🔴     | Shift cash summary per staff                                                                                         |
| 🔴     | A QR code for a session, and a scan that opens that session                                                          |
| 🔴     | Online checkout (PayMongo, GCash), webhooks, and payouts                                                             |

## Availability and areas

| Status | Feature                                                                                                                    |
| ------ | -------------------------------------------------------------------------------------------------------------------------- |
| 🟢     | Every listing has a Main area. It cannot be renamed or deleted                                                            |
| 🟢     | An area can monitor a spot count and can limit vehicle types. No types selected means every type                          |
| 🟢     | Free spots are total minus started open sessions, minus Reserved, minus Unavailable, and never below zero                 |
| 🟢     | The Full switch makes drivers see zero spots. A listing is full only when every relevant area is full                     |
| 🟢     | A future reservation does not take a spot until it starts                                                                 |
| 🟢     | Availability is per area, with Sessions and Reservations tabs and a plate filter on each                                  |
| 🟢     | Available slots editor sets Reserved and Unavailable for the area. They are not named bays                                |
| 🔴     | Named spots (slots mode): each bay available, occupied, Reserved, or Unavailable, with size limits                        |
| 🔴     | Search that hides a listing when the vehicle is taller or wider than the spot                                             |

## Listing management

| Status | Feature                                                                                                                    |
| ------ | -------------------------------------------------------------------------------------------------------------------------- |
| 🟢     | List Your Space: name, pin, optional address filled from the pin, rules, photo, areas, reservation requests, free parking. Track capacity starts off. Off hides the field and keeps the number |
| 🟢     | Guests see List your parking space. Choosing it asks them to sign in or create an account, then opens listing setup |
| 🟢     | A new listing stays hidden until an admin publishes it                                                                     |
| 🟢     | Edit listing, including restore saved pin and the free-parking switch. Track capacity is set on Rates and Edit rate |
| 🟢     | Hub for owners and managers: Availability, edit, areas, rates, fee presets, staff. A free listing hides fee presets       |
| 🟢     | Staff hub: Availability and Messages                                                                                       |
| 🟢     | Delete listing by sliding to confirm. Refused while a session is still open                                               |
| 🟢     | Fee presets                                                                                                                |
| 🟢     | Staff invite by email or phone, without saying whether the account exists. Accept or decline. Resend waits three minutes  |
| 🔴     | Moving the pin sets the listing back to Unverified                                                                         |

## Chat and notifications

| Status | Feature                                                                                                                |
| ------ | ---------------------------------------------------------------------------------------------------------------------- |
| 🟢     | Inbox and one thread per listing and driver. Text and photos                                                          |
| 🟢     | Notifications open the related screen. A staff invite can be accepted or declined there                               |
| 🟢     | Android push through Expo and FCM. Tapping a push opens the same screen as the list                                   |
| 🟢     | A new chat message is a push only, with no in-app notification row                                                    |
| 🟢     | Admins can turn each push type off without stopping the in-app notification                                           |
| 🔴     | Session events shown inside the chat (started, ended, payment, fee, waiver)                                           |
| 🔴     | Report a chat message, and hide one from the admin queue                                                              |
| 🔴     | Forgot password                                                                                                        |

## Account

| Status | Feature                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| 🟢     | Email and password sign-in and create account. Google sign-in. Phone sign-in is off unless the flag is on   |
| 🟢     | Accounts saved on this device: switch, add, sign out one, continue as a guest                               |
| 🟢     | Profile name, photo, and maps app. The photo is used in chat and reviews                                    |
| 🟢     | Saved vehicles: type, plate, optional nickname, one default. Search starts on that type                      |
| 🟢     | Shortcuts                                                                                                    |
| 🟢     | Privacy Policy, public                                                                                       |
| 🟢     | Contact Us for guests and signed-in people: category, message, up to five images                             |
| 🟡     | Phone sign-in. The screen can show it when `PHONE_SIGN_IN_ENABLED` is on. It is off                         |
| 🔴     | Vehicle height, width, and length on a saved vehicle                                                         |

## Links

| Status | Feature                                                                                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🟡     | A link to the public site (the first host in `web-host.json`, today https://where-to-park.expo.app) opens the installed Android app on that page. Chrome can offer Open in the app. Google sign-in on the website stays in the browser. iOS claims the same hosts; the Apple file waits on the Apple Team ID. Replacing the address is in eas-build.md |

## Admin

| Status | Feature                                                                                                                |
| ------ | ---------------------------------------------------------------------------------------------------------------------- |
| 🟢     | Verification queue. Publish without verifying, verify (which also publishes), or reject with a reason                 |
| 🟢     | Moderation: resolve, hide, or dismiss a report of a listing or a review                                                |
| 🟢     | Contact messages: open, mark resolved or open, delete. Images must be cleared before the message is deleted           |
| 🟢     | One switch per push type                                                                                               |
| 🟢     | System Settings, admins only: the search radius limit                                                                  |

## Admin reports

Candidates for a Reports screen that only an admin can open. None of these are built. Each one is a date range, for the whole platform or one listing, that the admin can generate. Pick which ones to implement.

| Status | Feature                                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴     | Sessions: stays started and ended, walk-in or reservation, by listing, area, and vehicle type                                                                   |
| 🔴     | Collections: payments collected by method, extra fees, waivers, refunds, and balances still open                                                                |
| 🔴     | Occupancy: how full each listing was over the period, and the busiest hours, from sessions and capacity                                                         |
| 🔴     | Reservations: requested, approved, rejected, cancelled, and no-show, by listing                                                                                 |
| 🔴     | Listings: new, published, hidden, verified, unverified, and free or paid                                                                                        |
| 🔴     | Reviews: new reviews and the average rating, by listing                                                                                                         |
| 🔴     | Moderation: driver reports of listings and reviews, still open or already handled                                                                               |
| 🔴     | Contact messages: Issue, Feedback, and Suggestion, still open or already handled                                                                                |
| 🔴     | Accounts: new driver and operator accounts                                                                                                                      |
| 🔴     | Operators: new operators, how many listings each has, published or hidden, and whether they had a session in the period                                        |

## Operator reports

Candidates for a Reports screen for an owner or a manager, covering only that operator's listings. Staff do not get this screen. Reports sits in the sidebar under My listings. Collections is built. The others are not. A shift cash summary for staff is already listed under Sessions and money.

| Status | Feature                                                                                                                    |
| ------ | -------------------------------------------------------------------------------------------------------------------------- |
| 🔴     | Sessions: stays started and ended on their listings, walk-in or reservation, by listing, area, and vehicle type           |
| 🟢     | Collections: a listing dropdown and a date-range dropdown. Custom dates use the system date picker. One payments total, collected, waivers, refunds, and balances still open now, for their listings. No split by payment method, and extra fees are not shown |
| 🔴     | Occupancy: how full each of their listings was, and the busiest hours                                                     |
| 🔴     | Reservations: requested, approved, rejected, cancelled, and no-show, for their listings                                   |
| 🔴     | Reviews: new reviews and the average rating, for their listings                                                           |
| 🔴     | Staff: check-ins, payments recorded, and sessions ended, per staff member, for their listings                             |

## Ads

| Status | Feature                                                                                                                                              |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟢     | AdMob banner at the bottom of Find Parking, Location details, Notifications, driver Sessions, and Availability (both tabs). Android only; never for admins |
| 🔴     | Interstitial ads                                                                                                                                     |
| 🔴     | EU/UK consent form (Google UMP)                                                                                                                      |

## Later

| Status | Feature                                                                      |
| ------ | ---------------------------------------------------------------------------- |
| 🔴     | iOS release                                                                  |
| 🔴     | Filipino language                                                            |
| 🔴     | Operator web dashboard                                                       |
| 🔴     | Occupancy reports and analytics. The candidate reports are listed under Admin reports and Operator reports |
| 🔴     | Gate or sensor integrations                                                  |
| 🔴     | A second map provider (Google Maps) behind the current map                   |

## Unimplemented

### Search and map

- In-app turn-by-turn navigation

### Listing details

- Operator's public reply on a review
- "Booked via app" on a review tied to a finished stay
- Staff rate a driver from a session

### Reservations

- Reservation fee and a hold that expires
- Automatic no-show release

### Sessions and money

- Shift cash summary per staff
- A QR code for a session, and a scan that opens that session
- Online checkout (PayMongo, GCash), webhooks, and payouts

### Availability and areas

- Named spots (slots mode): each bay available, occupied, Reserved, or Unavailable, with size limits
- Search that hides a listing when the vehicle is taller or wider than the spot

### Listing management

- Moving the pin sets the listing back to Unverified

### Chat and notifications

- Session events shown inside the chat (started, ended, payment, fee, waiver)
- Report a chat message, and hide one from the admin queue
- Forgot password

### Account

- Vehicle height, width, and length on a saved vehicle

### Admin reports

- Sessions: stays started and ended, walk-in or reservation, by listing, area, and vehicle type
- Collections: payments collected by method, extra fees, waivers, refunds, and balances still open
- Occupancy: how full each listing was over the period, and the busiest hours, from sessions and capacity
- Reservations: requested, approved, rejected, cancelled, and no-show, by listing
- Listings: new, published, hidden, verified, unverified, and free or paid
- Reviews: new reviews and the average rating, by listing
- Moderation: driver reports of listings and reviews, still open or already handled
- Contact messages: Issue, Feedback, and Suggestion, still open or already handled
- Accounts: new driver and operator accounts
- Operators: new operators, how many listings each has, published or hidden, and whether they had a session in the period

### Operator reports

- Sessions: stays started and ended on their listings, walk-in or reservation, by listing, area, and vehicle type
- Occupancy: how full each of their listings was, and the busiest hours
- Reservations: requested, approved, rejected, cancelled, and no-show, for their listings
- Reviews: new reviews and the average rating, for their listings
- Staff: check-ins, payments recorded, and sessions ended, per staff member, for their listings

### Ads

- Interstitial ads
- EU/UK consent form (Google UMP)

### Later

- iOS release
- Filipino language
- Operator web dashboard
- Occupancy reports and analytics. The candidate reports are listed under Admin reports and Operator reports
- Gate or sensor integrations
- A second map provider (Google Maps) behind the current map
