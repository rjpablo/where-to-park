# Test cases

**As of 15 Nov 2026.** Checks for the behavior in [implemented.md](implemented.md). Each case is something a person can try. Where the rule is pure logic, the named unit test must agree with the case. Run it with:

```bash
node --experimental-strip-types --test path/to/file.test.ts
```

Money is Philippine pesos. Listing times and rate days use Asia/Manila.

## Sidebar and navigation

**NAV-01.** Open Find Parking as a guest and open the sidebar. **Expect:** Sign in and Contact Us. No My listings, Sessions, or admin items.
Unit: `src/lib/sidebar.test.ts`

**NAV-02.** Open the sidebar while signed in, with no listing and no staff membership. **Expect:** My profile, Messages, Notifications, Sessions, and Saved vehicles, plus List your parking space. My listings is absent.

**NAV-03.** Open the sidebar as an owner, manager, or staff member. **Expect:** My listings is shown instead of List your parking space.

**NAV-04.** Open the sidebar as an admin. **Expect:** Verify listings, Moderation queue, Contact messages, Push notifications, and System settings. A pending count shows on the row that has one, and the red attention dot follows `get_sidebar_counts`. A trigger turned off in the database does not light the dot.
Unit: `src/lib/sidebar.test.ts`

**NAV-05.** Open a child screen from a link while the history stack is empty, then press Back. **Expect:** Back is shown and goes to that screen's parent, one level at a time, down to Find Parking. It does not leave the app.
Unit: `src/lib/backFallback.test.ts`, `src/lib/backToExit.test.ts`

**NAV-06.** On Find Parking, with nothing to go back to, maximize the results sheet and press the Android hardware back button. **Expect:** the sheet snaps to Minimized. "Press back again to close the app" does not appear.
Unit: `src/lib/backToExit.test.ts`

**NAV-07.** On Find Parking, with the sheet already minimized and nothing to go back to, press hardware back, then press it again within 2 seconds. **Expect:** the first press shows "Press back again to close the app". The second press closes the app. A second press after more than 2 seconds warns again instead of closing.

**NAV-08.** Repeat NAV-07 with the sheet at Normal. **Expect:** the same press-again-to-close prompt. The sheet is not minimized first.

**NAV-09.** From a listing opened on top of Find Parking, press hardware back. **Expect:** the app returns to Find Parking. The exit prompt does not appear.

## Finding parking

**SEARCH-01.** Open Find Parking with location allowed. **Expect:** the first search is around the device location. The map shows those listing pins and the sheet lists the same results. The sheet opens at Normal. Tapping a row opens Listing details.
Unit: `src/lib/userLocation.test.ts`

**SEARCH-02.** Drag the sheet handle, and tap the handle. **Expect:** drag moves among Minimized, Normal, and Maximized. A tap cycles Minimized, then Normal, then Maximized, then Minimized. Maximized leaves a strip of map under the header.
Unit: `src/lib/sheetLayout.test.ts`

**SEARCH-03.** Search an area while the map is zoomed in far enough that a result pin is off the map. **Expect:** the map zooms out around the search centre until every pin is on screen. The centre cursor stays the search point.
Unit: `src/components/map/camera.test.ts` (`zoomOutToFit`)

**SEARCH-04.** Search an area while every result pin is already on screen. **Expect:** the camera does not move and does not zoom in.

**SEARCH-05.** After a search, change a filter or the sort, and wait for a live availability update. **Expect:** the pins and the list update. The camera and the sheet position stay put.
Unit: `src/lib/liveAvailability.test.ts`

**SEARCH-06.** Pan or zoom the map. **Expect:** Search this area appears. Tapping it searches the map centre and opens the sheet at Normal. The distance slider resets to the new maximum, which is the distance from the centre to the farthest visible corner, rounded up, between 0.5 km and the search limit (50 km unless an admin changed it).
Unit: `src/lib/distance.test.ts`

**SEARCH-07.** Pick a place in the search box. **Expect:** the map moves to that place and Search this area is offered. The search does not run until that button is pressed. ◎ recenters on the device location at zoom 15 and also offers Search this area. Denying location permission shows a short message and does not search another city. A place search still moves the map.
Unit: `src/lib/userLocation.test.ts`, `src/lib/geocoding/photonParse.test.ts`, `src/lib/searchLink.test.ts`

**SEARCH-08.** As a guest, open the vehicle filter. **Expect:** it starts at All vehicles. Signed in, with a default saved vehicle, it starts at that vehicle type.
Unit: `src/lib/searchFilters.test.ts`

**SEARCH-09.** Set the rate-type filter, turn on Free parking, and turn Show Full off. **Expect:** Show Full is the last filter. Free parking shows only listings marked free. Full listings are hidden until Show Full is on. A free listing's price reads Free. A listing is full only when every area that takes the vehicle is full.
Unit: `src/lib/searchFilters.test.ts`, `src/lib/areas.test.ts`

**SEARCH-10.** Change the sort. **Expect:** distance, price, rating, eta, and open spots. Open spots is labelled in lowercase and is last.
Unit: `src/lib/searchFilters.test.ts`

**SEARCH-11.** Read a result row. **Expect:** the pin and the row show how many spots are free. Drive-time ETAs use OpenRouteService. If routing fails, the row falls back to a straight-line estimate and marks it as an estimate.
Unit: `src/lib/listingEta.test.ts`, `src/lib/availability.test.ts`

**SEARCH-12.** Lower the distance slider and change a filter. **Expect:** the chosen distance is kept, clamped under the current maximum. Only a new area search resets the distance to the maximum.

**SEARCH-13.** Open Find Parking with location denied, blocked, or unavailable. **Expect:** no search runs. The sheet does not list results from another city. Searching for a place still moves the map and offers Search this area.
Unit: `src/lib/userLocation.test.ts`

**SEARCH-14.** Look at the map with the results sheet minimized. **Expect:** the sheet covers only a sliver of the map's bottom edge. The centre cursor sits in the middle of the map that stays visible.
Unit: `src/lib/sheetLayout.test.ts`

**SEARCH-15.** Search an area whose farthest corner is beyond the search limit. **Expect:** an alert says the search only includes listings within that limit. The slider and the search stop at the limit. A map that already fits does not show the alert.
Unit: `src/lib/distance.test.ts`

## Listing details

**LISTING-01.** Open a published listing as a guest. **Expect:** Overview, Reviews, and Photos. Overview shows the name, a Verified or Unverified badge, the address, who listed it, how many people are viewing, free spots, and when availability was last updated.
Unit: `src/lib/detailTabs.test.ts`, `src/lib/viewerPresence.test.ts`

**LISTING-02.** Open a free listing. **Expect:** Free parking is shown instead of rate rows. The overnight line is hidden.
Unit: `src/lib/rates.test.ts` (`cardRateText`)

**LISTING-03.** Open a paid listing that has overnight turned on, as a guest or driver. **Expect:** a short overnight line. The overnight editor is absent.

**LISTING-04.** Open the same listing as an owner or manager. **Expect:** Allow overnight is shown. Turning it on requires a start time, an end time, and a price greater than 0. The times must differ. A window that crosses midnight is accepted.
Unit: `src/lib/overnight.test.ts`

**LISTING-05.** Open a listing that allows reservation requests, then one that does not. **Expect:** the first shows Reserve a spot. The second says reservations are not allowed.
Unit: `src/lib/reservations.test.ts`

**LISTING-06.** Tap Navigate. **Expect:** the chosen maps app opens for that pin.
Unit: `src/lib/navigation.test.ts`

**LISTING-07.** As a guest, look for Report listing and Open Chat. **Expect:** Report listing is absent until sign-in. Open Chat is at the bottom and opens that listing's thread, asking for sign-in when needed.

**LISTING-08.** Open the photo strip, then the Photos tab. **Expect:** the strip opens a full-screen viewer. Photos are the operator's gallery plus review photos. Review photos are tagged "From a review". The Photos tab is a grid of the same collection.
Unit: `src/lib/photoCollection.test.ts`, `src/lib/carousel.test.ts`, `src/lib/reviewPhotos.test.ts`

**LISTING-09.** As a signed-in driver, write a review with stars, text, and photos, then report someone else's review. **Expect:** the review is saved. A review can be reported. The photo cap is 5.
Unit: `src/lib/listingReview.test.ts`, `src/lib/reviewPhotos.test.ts`, `src/lib/rating.test.ts`

**LISTING-10.** Tap Add shortcut, then open Shortcuts. **Expect:** the listing is saved. A guest's shortcuts merge into the account on sign-in.
Unit: `src/lib/shortcuts.test.ts`

## Reservations and driver sessions

**RESERVE-01.** On a listing that allows requests, open Reserve a spot. **Expect:** a saved vehicle can be picked, or a vehicle and plate typed. Start and end are required. The price breakdown is shown before the request is sent.
Unit: `src/lib/reservations.test.ts`, `src/lib/quotePreview.test.ts`

**RESERVE-02.** Send a request whose vehicle is accepted by Main, then one whose vehicle is not. **Expect:** the first is assigned to Main. The second goes to the next area that accepts that vehicle. An area with no vehicle types selected accepts every type.
Unit: `src/lib/reservations.test.ts`, `src/lib/areas.test.ts`

**RESERVE-03.** Open Sessions as the driver. **Expect:** sections are Waiting for approval, Approved reservations, Active, Previous, Rejected, and Cancelled.
Unit: `src/lib/reservations.test.ts`

**RESERVE-04.** Open a waiting request. **Expect:** place, status, plate, vehicle, start, end, and a collapsible planned price. Edit returns to Reserve a spot. Cancel opens a dialog with slide-to-confirm and Keep it. Open Chat is at the bottom and opens the listing chat.
Unit: `src/lib/slideToConfirm.test.ts`

**RESERVE-05.** Open an approved reservation as the driver. **Expect:** it can be cancelled through the same dialog. A rejected or cancelled request cannot be edited as if it were still waiting.

**RESERVE-06.** As staff, open a waiting request. **Expect:** Approve is available. Reject opens a dialog with Slide to reject and Keep it. Cancel, Apply payment, and Add fee are absent until it is approved. Vehicle, plate, times, and rate cannot be edited. The area can be changed.

**RESERVE-07.** On Availability, open the Reservations tab. **Expect:** an approved reservation is tagged Approved. A waiting one is tagged For Approval.

**RESERVE-08.** Check in a walk-in. **Expect:** there is no approval step. It is treated as already approved.

## Pricing

**PRICE-01.** Save an hourly rate, a daily rate, a flat-then-hourly rate, and a monthly rate. **Expect:** each type requires its own amounts. Flat-then-hourly also requires the first-N hours and the succeeding hourly amount. The breakdown for that type reads "Flat for first Nh" and "N succeeding hours".
Unit: `src/lib/rates.test.ts`

**PRICE-02.** Quote an ordinary stay while a monthly rate exists, and quote a stay with the monthly rate chosen. **Expect:** the ordinary stay is not priced as monthly. The chosen monthly rate is used only when it is selected. The Rates preview stays hourly and does not switch onto monthly.
Unit: `src/lib/quotePreview.test.ts`

**PRICE-03.** Limit a rate to weekdays, a date range, one vehicle type, and one area. Start a stay on a Manila day outside that limit. **Expect:** that rate is not used. The default rate still applies: every day, no dates, no vehicle, no area.
Unit: `src/lib/rateForm.test.ts`, `src/lib/rates.test.ts`

**PRICE-04.** Try to delete the default rate, then make another rate the default and delete the old one. **Expect:** the first delete is refused. The second succeeds. Deactivating a rate that is in use moves those hours onto the rates still in effect.
Unit: `src/lib/rates.test.ts`

**PRICE-05.** Turn overnight on and quote a stay that crosses the window, including one that crosses midnight, and one that sits entirely inside the window. **Expect:** overnight hours are left out of the hourly total. One overnight fee is added per night the stay covers. The line reads "Overnight: 1 night". A stay entirely inside the window is the overnight fee only. A monthly stay is unchanged.
Unit: `src/lib/overnight.test.ts`

**PRICE-06.** Turn Free parking on and quote a stay. **Expect:** the price is ₱0 and the breakdown says Free. Overnight and saved rates are not used. The rate list on the Rates screen stays available.

## Walk-in sessions and money

**WALKIN-01.** Open Check In for an area. **Expect:** area, vehicle, plate, start defaulting to now, optional end, and a rate of Automatic or a chosen rate. The planned price is shown before save. Saving returns to Availability.
Unit: `src/lib/walkIn.test.ts`, `src/lib/dateTimeField.test.ts`

**WALKIN-02.** Set an end at or before the start, and leave the start empty. **Expect:** both are refused. An end after the start is accepted.
Unit: `src/lib/walkIn.test.ts`

**WALKIN-03.** Check in a plate that already has an open session at that listing. **Expect:** the save is refused and names the plate, with a way to open the existing session.
Unit: `src/lib/walkIn.test.ts`

**WALKIN-04.** Check in to an area that is full or switched to Full. **Expect:** a confirmation is shown. Confirming still creates the session.
Unit: `src/lib/walkIn.test.ts`

**WALKIN-05.** Open an open walk-in as staff. **Expect:** plate, vehicle, listing, area, status, and a collapsible price calculation. Edit details, Add fee, Apply payment, and End session are available.
Unit: `src/lib/walkIn.test.ts`

**WALKIN-06.** Open Edit details for a walk-in, then for a reservation. **Expect:** the walk-in can change vehicle, plate, times, rate, and note. The reservation cannot be edited on this screen.

**WALKIN-07.** Apply a payment for part of the balance, then end the session while a balance remains. **Expect:** cash or another method is recorded, with an optional note. Ending offers to record the remaining payment or, when allowed, waive it with a reason.
Unit: `src/lib/walkIn.test.ts`

**WALKIN-08.** End a session that was overpaid, and cancel a reservation that already had a payment. **Expect:** a refund can be recorded for the extra amount.
Unit: `src/lib/walkIn.test.ts`

**WALKIN-09.** Add a fee from a saved preset, then on a listing with no presets add a custom name and amount. **Expect:** the preset is applied. The custom fee is stored as an additional charge with no preset. An additional fee can be removed while the session is open. A waiting reservation cannot take a fee, and Apply payment is hidden for it.
Unit: `src/lib/walkIn.test.ts`

**WALKIN-10.** Open chat from a staff session that has a driver, then from one that does not. **Expect:** the first opens that driver's thread. The second opens the listing chat.

## Availability

**AVAIL-01.** Open Availability and switch areas. **Expect:** a monitored area shows the free count, a pencil to the slots editor, and the Full switch. An unmonitored area shows Available or Full. Sessions and Reservations are separate tabs, each with its own plate filter. **+** opens Check In for the selected area.
Unit: `src/lib/areas.test.ts`, `src/lib/walkIn.test.ts` (`filterByPlate`)

**AVAIL-02.** With a monitored area, start an open session, set Reserved and Unavailable, and switch the area to Full. **Expect:** free spots are total minus started open sessions, minus Reserved, minus Unavailable, and never below zero. Full makes drivers see zero spots. A future reservation does not take a spot until it starts. Unmonitored areas add no number. The listing is full only when every area that takes the vehicle is full.
Unit: `src/lib/availability.test.ts`, `src/lib/areas.test.ts`

**AVAIL-03.** In the slots editor, set Reserved and Unavailable above the total, then set them within the total. **Expect:** the first is refused. The second reduces the free count. The counts are not named parking bays.
Unit: `src/lib/availability.test.ts`

## Listing management

**MANAGE-01.** Open My listings as an owner or staff member. **Expect:** each listing shows free spots or Full, and its verification state. **+ Add a listing** starts onboarding. A rejected listing can be resubmitted.
Unit: `src/lib/areas.test.ts`

**MANAGE-02.** Complete List Your Space with a name, a pin, rules, a photo, areas, and the reservation-requests switch. Leave the address blank. **Expect:** the address field is on the pin step. The blank address is filled from the pinned place. The listing is submitted hidden, and it stays out of search until an admin publishes it.
Unit: `src/lib/geocoding/address.test.ts`, `src/lib/pinRestore.test.ts`

**MANAGE-03.** On the capacity step, leave both switches off, then turn Track capacity on, enter a number, and turn it off. Try 0 while it is on. Turn Free parking on, then turn it off. **Expect:** Track capacity starts off and the capacity field is hidden. The review still shows the capacity and says it is not counted. Turning tracking on shows the field. 0 is refused. A whole number of at least 1 is kept when tracking is turned off again. Free parking hides the rate fields and the cash-payment note, and a rate is not required. Turning free parking off turns tracking off again. Place search and ◎ work on the pin map. Dragging the map pans the map rather than the form. There is no restore-pin button, because a new listing has no saved pin.
Unit: `src/lib/listingCapacity.test.ts`, `src/lib/pinRestore.test.ts`

**MANAGE-04.** Open a listing hub as an owner or manager, then as staff. **Expect:** owners and managers see Availability, Edit details and photos, Areas, Rates, Fee presets, and Staff. Staff see Availability and Messages. Fee presets are hidden when the listing is free, and Rates stays. Everyone who can open the hub can view the public page.

**MANAGE-05.** Delete a listing that has an open session, then delete one that does not. **Expect:** the first is refused and offers a way back to Availability. The second asks for a slide to confirm, then deletes.
Unit: `src/lib/deleteListing.test.ts`, `src/lib/slideToConfirm.test.ts`

**MANAGE-06.** Edit the listing. Move the pin, clear the address, change Free parking, and change the reservation-requests switch. **Expect:** the address field is on the pin picker. A blank address is filled from the pin. A restore control appears only after the pin moves away from the saved position and puts it back. Spot capacity is not on this screen. Manage areas opens Areas. Free parking is on this screen and saves with the form. Turning it off stops counting spots and keeps the capacity number.
Unit: `src/lib/geocoding/address.test.ts`, `src/lib/pinRestore.test.ts`

**MANAGE-07.** Open Areas. Try to rename or delete Main, add an area, and delete another area. **Expect:** Main is listed first and has no delete. Its name is read-only. Deleting another area asks first.
Unit: `src/lib/areas.test.ts`

**MANAGE-08.** Edit an area's monitoring, total, and vehicle types, leaving every type unchecked. **Expect:** no types selected means every type. A monitored area stores a total.
Unit: `src/lib/areas.test.ts`

**MANAGE-09.** On Rates, turn Track capacity on and off, open Edit rate, and use a rate row. **Expect:** Free parking is not on this screen. Track capacity is on Rates and on Edit rate. Off hides the field and stops counting spots. The capacity number stays. On requires a whole number of at least 1. The preview uses the same price function as a real stay, including a flat-rate split and an overnight line when the sample hours fall in the window. A row can be edited, activated, deactivated, archived, restored, or set as the default.
Unit: `src/lib/listingCapacity.test.ts`, `src/lib/quotePreview.test.ts`, `src/lib/rates.test.ts`

**MANAGE-10.** Create a rate and edit one. **Expect:** the form has type, amounts, an optional vehicle, days of the week, and effective dates. Dates are Manila days, and the end date covers that whole day. Saving returns to the list. The default rate's edit does not send a vehicle, an area, or an inactive flag.
Unit: `src/lib/rateForm.test.ts`

**MANAGE-11.** Add a fee preset. **Expect:** it is a named extra charge that staff can later apply on Add fee.

**MANAGE-12.** Invite staff by an email that has an account, and by one that does not. **Expect:** the screen does not say whether the account exists. The person is not added immediately. They get a notification with Accept and Decline and appear in Members only after Accept. Resend waits three minutes. An invite can be limited to specific listings.
Unit: `src/lib/staffInvite.test.ts`

## Chat and notifications

**CHAT-01.** Open Messages as a driver, then as staff. **Expect:** the driver sees their own conversations. Staff also see driver threads on their listings. A row shows the latest message and an unread mark. Opening a row opens that thread. A `driverId` on the chat route opens that driver's thread.

**CHAT-02.** Send a text and a photo in a thread. **Expect:** both appear. The photo uses a signed URL and is not signed again while the URL is still fresh.
Unit: `src/lib/signedUrls.test.ts`, `src/lib/inbox.test.ts`

**CHAT-03.** Open Notifications and tap a reservation request, a decision, a chat, a listing review, a staff invite, an admin item, and an unknown type. **Expect:** the request opens the staff session, the decision opens the driver's session, the chat opens the thread, the review opens the listing, the invite stays on Notifications so it can be accepted or declined, the admin item opens the matching admin screen, and the unknown type stays on the list. The tapped row is marked read.
Unit: `src/lib/notificationRoute.test.ts`

**CHAT-04.** Sign in on Android. **Expect:** the device push token is registered. Tapping a push opens the same screen as the matching notification. A new chat message arrives as a push and does not add an in-app notification row.

**CHAT-05.** As an admin, turn one push type off, then trigger that event. **Expect:** the phone push is skipped. The in-app notification is still created.
Unit: `supabase/functions/send-push/lib.test.ts`

## Account

**ACCOUNT-01.** Create an account with email and password, then sign in. **Expect:** the email is trimmed and lower-cased. A bad email or a short password is refused with a readable message. The password can be shown and hidden.
Unit: `src/lib/emailAuth.test.ts`

**ACCOUNT-02.** Look for phone sign-in. **Expect:** it is hidden unless `PHONE_SIGN_IN_ENABLED` is on.
Unit: `src/lib/emailAuth.test.ts`

**ACCOUNT-03.** Sign in with Google as a new account, then open a page that required sign-in. **Expect:** a new account asks for a display name. After Google, the person returns to the `next` path when it is an in-app path. Anything else returns to Find Parking.
Unit: `src/lib/oauthCallback.test.ts`, `src/lib/authReturn.test.ts`

**ACCOUNT-04.** On Accounts, add an account, switch to it, sign out of one, and continue as a guest. **Expect:** saved accounts stay on this device. The list stores no secrets. A profile photo is kept until the account is removed.
Unit: `src/lib/accounts.test.ts`

**ACCOUNT-05.** On Profile, change the display name and photo, and link Google. **Expect:** the name and photo save. The phone is shown when the account has one. The photo is the one used in chat and reviews.
Unit: `src/lib/avatar.test.ts`

**ACCOUNT-06.** Save two vehicles and mark one as the default. **Expect:** each has a type, a plate, and an optional nickname. Find Parking starts on the default type. Reserve a spot can pick a saved vehicle.

**ACCOUNT-07.** On Shortcuts, hold a row and drag it, then delete one. **Expect:** the order changes. Delete asks first. The sidebar shows the first three.
Unit: `src/lib/shortcuts.test.ts`

**ACCOUNT-08.** Open Privacy Policy while signed out. **Expect:** the page is public. Back with no history returns to Find Parking.
Unit: `src/lib/privacyPolicy.test.ts`

**ACCOUNT-09.** Send Contact Us as a guest, twice, with a category, a message, and up to five images. Leave the reply contact empty, then send one with an email or a phone. **Expect:** Issue, Feedback, and Suggestion are the categories. A message is required. More than five images is refused. A reply contact is optional and, when present, must be an email or a phone. The second guest submission is treated as the same sender.
Unit: `src/lib/contact.test.ts`

## Admin

**ADMIN-01.** Open the Verification Queue. **Expect:** listings waiting for verification are listed, each as Hidden or Published, and Unverified. Open shows the public page. An unpublished listing can still be opened by the admin.

**ADMIN-02.** Publish a hidden listing without verifying it. **Expect:** it becomes visible in search, the badge stays Unverified, and it remains in the queue. The operator is notified.

**ADMIN-03.** Verify a listing, then reject another with a reason. **Expect:** verify marks it Verified and publishes it, and removes it from the queue. Reject hides it and notifies the operator. Only the button that was pressed shows a loading state.

**ADMIN-04.** On Moderation, resolve a report, hide the reported listing or review, and dismiss a report. **Expect:** each action completes and the queue updates.

**ADMIN-05.** Open a Contact Us message that has images, delete the message, then delete the images first and delete the message again. **Expect:** the first delete is refused until the images are cleared. The second delete removes the message.
Unit: `src/lib/contact.test.ts`

**ADMIN-06.** On Push notifications, turn one type off and another on. **Expect:** each type has its own switch. Off skips only that phone push.
Unit: `supabase/functions/send-push/lib.test.ts`

**ADMIN-07.** As an admin, open System Settings and save a search radius limit. **Expect:** a whole number of kilometres from 1 to 500 is saved. The field starts at the current limit, 50 by default. Someone who is not an admin does not see System settings in the sidebar.
Unit: `src/lib/distance.test.ts`, `src/lib/sidebar.test.ts`

## Ads

**ADS-01.** On an Android build, open Find Parking, a Location Details page, Notifications, Sessions, and Availability (switch between the Sessions and Reservations tabs) as a driver, then as staff. **Expect:** a banner sits at the bottom of each screen, above the navigation bar. It covers no button: the results sheet, the ◎ button, Open Chat, and the + button stay above it. Lists scroll to their end above the banner.

**ADS-02.** Open the same screens signed in as an admin. **Expect:** no banner and no blank strip at the bottom.
Unit: `src/lib/ads.test.ts`

**ADS-03.** Open sign-in, a chat thread, Check In, Edit details, Apply payment, Add fee, Reserve a spot, List Your Space, and Profile. **Expect:** no ads.

**ADS-04.** Open the screens from ADS-01 with no internet (or when no ad fills). **Expect:** the banner does not appear and leaves no gap; the screen looks as it did before ads.

**ADS-05.** Open the web app. **Expect:** no ads anywhere.

**ADS-06.** In a development build, check the banner. **Expect:** it is labeled "Test Ad". A release build requests the real Where To Park unit.
Unit: `src/lib/ads.test.ts`
