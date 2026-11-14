# Feature status

**As of 15 Nov 2026.** Planned features, and whether each one is in the app.

Add a row when a feature is planned. Status:

- **Done** — in the app today. What it does is in [implemented.md](implemented.md).
- **Partial** — some of it is in the app.
- **Not started** — planned, not built.

Do not delete a row when it ships. Change its status. [spec.md](spec.md) is the design history, including behavior that was later revised. Checks are in [test-cases.md](test-cases.md).

## Search and map

| Status      | Feature                                                                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Done        | Find Parking map and results sheet, no sign-in required. The first search uses the device location, and does not fall back to another place. The map ends just under the minimized sheet so the centre cursor sits in the visible map |
| Done        | Sheet heights Minimized, Normal, and Maximized. A new search opens Normal. Handle tap cycles the three heights                                                   |
| Done        | Place search (Photon) and the ◎ current-location button. Neither searches until Search this area                                                                |
| Done        | Distance slider follows the visible map (0.5 km up to the search limit, 50 km unless an admin changed it). A wider map shows an alert that the search was limited. A new search sets the slider to that maximum; filters and sort keep the chosen value |
| Done        | Opening zoom 13.25                                                                                                                                               |
| Done        | Filters: vehicle, rate type, Free parking, Show Full last. Full listings stay hidden until Show Full is on                                                      |
| Done        | Sort by distance, price, rating, eta, and open spots                                                                                                             |
| Done        | Pins and rows show free spots. A free listing's price reads Free. Drive-time ETAs fall back to a straight-line estimate                                         |
| Done        | Clusters sum the free spots inside them. Tapping a cluster zooms until its pins are visible                                                                      |
| Done        | Live availability refresh keeps the camera and the sheet where they are                                                                                         |
| Done        | After a new area search, the map zooms out around the search centre only when a result pin is off screen                                                        |
| Done        | Each result row has Navigate, using the maps app chosen on Profile                                                                                              |
| Done        | Returning from Listing details keeps the camera, results, filters, sort, and sheet position                                                                    |
| Done        | Android hardware back on Find Parking, with nothing to go back to: a maximized sheet minimizes. Minimized or Normal uses "Press back again to close the app"   |
| Not started | In-app turn-by-turn navigation                                                                                                                                   |

## Listing details

| Status      | Feature                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Done        | Overview, Reviews, and Photos                                                                                                    |
| Done        | Verified or Unverified badge, address, who listed it, viewers, free spots, and when availability was last updated               |
| Done        | Photo strip and full-screen viewer. Review photos are tagged "From a review"                                                    |
| Done        | Free parking shows Free parking instead of rates and hides overnight                                                            |
| Done        | Reserve a spot only when the listing allows requests                                                                             |
| Done        | Navigate opens the chosen maps app at the pin                                                                                    |
| Done        | Report listing after sign-in. Open Chat at the bottom                                                                            |
| Done        | Signed-in drivers write a review with stars, text, and up to 5 photos, and can report a review                                   |
| Done        | Add shortcut, reorder, and delete. Guest shortcuts can merge into the account on sign-in                                         |
| Done        | Owners and managers edit Allow overnight (start, end, price; the window may cross midnight)                                      |
| Not started | Operator's public reply on a review                                                                                              |
| Not started | "Booked via app" on a review tied to a finished stay                                                                             |
| Not started | Staff rate a driver from a session                                                                                               |

## Reservations

| Status      | Feature                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| Done        | Driver requests a spot: vehicle, plate, start, end, and the price before sending                                    |
| Done        | The stay goes to Main when that area accepts the vehicle, otherwise the next area that does                         |
| Done        | Driver Sessions sections: waiting, approved, active, previous, rejected, cancelled                                  |
| Done        | While waiting, the driver can edit or cancel. An approved reservation can be cancelled. Cancel uses slide-to-confirm |
| Done        | Staff approve, or reject with slide-to-confirm. They can change the area. They cannot edit vehicle, plate, times, or rate until it is approved |
| Done        | A waiting reservation has no Cancel, Apply payment, or Add fee until it is approved                                 |
| Not started | Reservation fee and a hold that expires                                                                              |
| Not started | Automatic no-show release                                                                                            |

## Pricing

| Status | Feature                                                                                                                    |
| ------ | -------------------------------------------------------------------------------------------------------------------------- |
| Done   | One price function, `price_stay`, for session quotes, reservation quotes, walk-in quotes, and the Rates preview            |
| Done   | Hourly, daily, flat then hourly, and monthly. Monthly prices a stay only when that rate is chosen                          |
| Done   | A rate can be limited to days, dates, one vehicle type, and one area. Each billed hour uses the rate in effect then        |
| Done   | One default rate, always applicable, not deletable until another rate is made the default                                  |
| Done   | Deactivate, activate, archive, and restore. Deactivating a rate that is in use moves those hours onto the rates in effect  |
| Done   | Overnight is a listing setting: one fee per night, including a window that crosses midnight. A monthly stay is unchanged   |
| Done   | Free parking prices a stay at ₱0. The rate list stays available                                                            |

## Sessions and money

| Status      | Feature                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| Done        | Walk-in check-in: area, vehicle, plate, start, optional end, Automatic or a chosen rate, price before save          |
| Done        | One open session per plate per listing                                                                              |
| Done        | A full area, or an area switched to Full, still accepts a session after staff confirm                               |
| Done        | Edit details for an open walk-in. A reservation is not edited there                                                  |
| Done        | Apply payment (cash or another method) against the balance                                                          |
| Done        | Add a fee preset, or a custom fee when the listing has none. Remove an additional fee while the session is open     |
| Done        | End session. A remaining balance can be paid or waived with a reason. Staff can waive only when the listing allows it |
| Done        | Refund an overpaid ended session, or a cancelled reservation that was already paid                                  |
| Done        | Overdue notification when a scheduled end passes                                                                    |
| Not started | Shift cash summary per staff                                                                                         |
| Not started | Online checkout (PayMongo, GCash), webhooks, and payouts                                                             |

## Availability and areas

| Status      | Feature                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| Done        | Every listing has a Main area. It cannot be renamed or deleted                                                            |
| Done        | An area can monitor a spot count and can limit vehicle types. No types selected means every type                          |
| Done        | Free spots are total minus started open sessions, minus Reserved, minus Unavailable, and never below zero                 |
| Done        | The Full switch makes drivers see zero spots. A listing is full only when every relevant area is full                     |
| Done        | A future reservation does not take a spot until it starts                                                                 |
| Done        | Availability is per area, with Sessions and Reservations tabs and a plate filter on each                                  |
| Done        | Available slots editor sets Reserved and Unavailable for the area. They are not named bays                                |
| Not started | Named spots (slots mode): each bay available, occupied, Reserved, or Unavailable, with size limits                        |
| Not started | Search that hides a listing when the vehicle is taller or wider than the spot                                             |

## Listing management

| Status      | Feature                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| Done        | List Your Space: name, pin, optional address filled from the pin, rules, photo, areas, reservation requests, free parking. Track capacity starts off. Off hides the field and keeps the number |
| Done        | A new listing stays hidden until an admin publishes it                                                                     |
| Done        | Edit listing, including restore saved pin and the free-parking switch. Track capacity is set on Rates and Edit rate |
| Done        | Hub for owners and managers: Availability, edit, areas, rates, fee presets, staff. A free listing hides fee presets       |
| Done        | Staff hub: Availability and Messages                                                                                       |
| Done        | Delete listing by sliding to confirm. Refused while a session is still open                                               |
| Done        | Fee presets                                                                                                                |
| Done        | Staff invite by email or phone, without saying whether the account exists. Accept or decline. Resend waits three minutes  |
| Not started | Moving the pin sets the listing back to Unverified                                                                         |

## Chat and notifications

| Status      | Feature                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| Done        | Inbox and one thread per listing and driver. Text and photos                                                          |
| Done        | Notifications open the related screen. A staff invite can be accepted or declined there                               |
| Done        | Android push through Expo and FCM. Tapping a push opens the same screen as the list                                   |
| Done        | A new chat message is a push only, with no in-app notification row                                                    |
| Done        | Admins can turn each push type off without stopping the in-app notification                                           |
| Not started | Session events shown inside the chat (started, ended, payment, fee, waiver)                                           |
| Not started | Report a chat message, and hide one from the admin queue                                                              |
| Not started | Forgot password                                                                                                        |

## Account

| Status      | Feature                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| Done        | Email and password sign-in and create account. Google sign-in. Phone sign-in is off unless the flag is on   |
| Done        | Accounts saved on this device: switch, add, sign out one, continue as a guest                               |
| Done        | Profile name, photo, and maps app. The photo is used in chat and reviews                                    |
| Done        | Saved vehicles: type, plate, optional nickname, one default. Search starts on that type                      |
| Done        | Shortcuts                                                                                                    |
| Done        | Privacy Policy, public                                                                                       |
| Done        | Contact Us for guests and signed-in people: category, message, up to five images                             |
| Partial     | Phone sign-in. The screen can show it when `PHONE_SIGN_IN_ENABLED` is on. It is off                         |
| Not started | Vehicle height, width, and length on a saved vehicle                                                         |

## Admin

| Status | Feature                                                                                                                |
| ------ | ---------------------------------------------------------------------------------------------------------------------- |
| Done   | Verification queue. Publish without verifying, verify (which also publishes), or reject with a reason                 |
| Done   | Moderation: resolve, hide, or dismiss a report of a listing or a review                                                |
| Done   | Contact messages: open, mark resolved or open, delete. Images must be cleared before the message is deleted           |
| Done   | One switch per push type                                                                                               |
| Done   | System Settings, admins only: the search radius limit                                                                  |

## Ads

| Status      | Feature                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Done        | AdMob banner at the bottom of Find Parking, Location details, Notifications, driver Sessions, and Availability (both tabs). Android only; never for admins |
| Not started | Interstitial ads                                                                                                                                     |
| Not started | EU/UK consent form (Google UMP)                                                                                                                      |

## Later

| Status      | Feature                                                                      |
| ----------- | ---------------------------------------------------------------------------- |
| Not started | iOS release                                                                  |
| Not started | Filipino language                                                            |
| Not started | Operator web dashboard                                                       |
| Not started | Occupancy reports and analytics                                              |
| Not started | Gate or sensor integrations                                                  |
| Not started | A second map provider (Google Maps) behind the current map                   |
