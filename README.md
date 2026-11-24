# Myrtle Creek Nursery: market till and stock app

**App address:** `https://parris-tech-services.github.io/myrtle-creek-nursery/`.

Works offline on an iPhone or iPad. Everything is saved the moment you tap, so there is no Save button. Each device keeps its own data: use one device per market and combine backups afterwards.

## Install on iPhone or iPad
1. Open the app's web address in **Safari**.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. From now on, **always open the app from the Home Screen icon**.

Safari wipes website data for sites not opened for about 7 days unless they are installed to the Home Screen. Open the app once with wifi first, so it can download itself for offline use.

## A normal market day
1. **Packing**: check the suggested quantities for the market. They come from that market's last 3 visits plus held orders. Edit if you like.
2. **Sell**: with no day open, tap **Start selling at ... today**. Or use **Market day** to pick a place and count the opening float by notes and coins (it can wait until later).
3. **Load stock**: confirm what you took. It comes off nursery stock.
4. **Sell**: tap products, tap **Pay**, pick Cash, Card or Transfer / PayID (Split payment is underneath). Deals apply automatically, best price for the customer. **Edit** a line for seconds or a discount, **Other item** for odd things, **Sold out** then the product to log when it ran out. Every sale shows an **Undo** for 10 seconds.
5. Cash opens a change calculator: tap Exact, a round amount or type it. Cash is rounded to the nearest 5c; card and transfer are not.
6. During the day: **Record loss**, **Cash out / expense** (stall fee, fuel, supplies, cash borrowed from the float), **Day notes** (weather, crowd, who was there).
7. **End day: check the takings** has 4 steps: count what is coming home (taken minus coming home should equal sold plus lost), count the cash (optionally set a float to keep for next market), check card and Transfer / PayID totals against the terminal and bank, then **Close day**. Closing can be undone. Every product needs a coming-home count, or tap **Everything sold: use expected**; plants sold beyond what was loaded come off nursery stock when you close.

## Orders
An order has a customer, items, a handover (market, Pambula pickup or delivery), a due date, a payment status and a fulfilment status. Held items are reserved: the Nursery screen shows on hand, held and available. Payments count as money on the day they are taken. Units count as sold on the day of collection, so money is never counted twice. Prepaid orders not yet collected show as a liability.

## Prices, products, people
**Prices** tab: pricing groups (price and multi-buy deals such as "4 for 15"), types, products (own price for trees), sub-categories (rename once, all products follow), people and locations. Each sale keeps the price it was sold at, so later changes never alter old sales.

## Backups
- Use the Google Sheet for the full backup after every market. CSV exports for sale lines, orders, cash counts and market days are available under Reports.
- **Restore** replaces everything; **Merge another file** combines devices, and for each record the newer change wins (a record with no date counts as older). A file that is cut short, damaged or missing parts is rejected before anything changes, with a clear message.
- The app keeps its last 5 automatic snapshots in a separate store that restores never touch, and takes one before every import. CSV exports are there too.
- Banners warn when a day has closed since the last backup, and turn red after more than 2 unbacked-up days.

### Google Sheet (optional, recommended)
Everything is copied to your own Google Sheet whenever there is signal, and the app only counts something as backed up when the sheet confirms it. The header chip shows **All backed up**, **3 waiting for signal** or **Sync error (tap)**. The Sheet has readable tabs (Sales, Market days, Cash counts and so on) and a hidden `_data` tab the app restores from.

1. Open the copy link you were given and tap **Make a copy**.
2. In your copy: **Extensions -> Apps Script -> Deploy -> New deployment -> Web app**. Execute as **Me**, Who has access **Anyone**, then **Deploy**.
3. Approve the permissions. If Google says **"Google hasn't verified this app"**, tap **Advanced**, then **Go to ... (unsafe)**. It is your own copy.
4. Click the blue **Web app URL** shown after deploying. A page opens with your connection code. Copy it. (Later: Sheet menu **Myrtle Creek -> Show connection code**.)
5. In the app: **Backup -> Connect Google Sheet**, paste the code.
6. To restore a device, first connect it to the Sheet (step 5), then **Backup -> Restore from Google Sheet**. **Resend everything** sends every record again.

If a newer copy of a record is already in the Sheet (saved from another device), the app keeps that copy instead of overwriting it.

**"Could not reach the Google Sheet":** check that **Who has access** is **Anyone**, then redeploy the script as a **New version** (Deploy -> Manage deployments -> pencil -> New version -> Deploy).

Keep the code private: anyone with it can read and write the sheet through the script. If the app says your Google Sheet needs a small update, **Backup -> How to update** copies the new script and shows the steps; the link stays the same.

Owner's one-time template: create an empty Google Sheet, **Extensions -> Apps Script**, paste `apps-script.gs`, save (no deploy), then share the link with `/edit` changed to `/copy`.

## Keeping your data safe
- **Never delete the Home Screen icon.** It deletes the data on that device.
- The basket on the Sell screen is saved as you go, so a reload or a flat battery does not lose it.
- **Never use "Clear History and Website Data"** in Safari settings.
- Carry a **power bank** on market days.
- A new version of the app never swaps in while a market day is open. Tap **Install update** after closing the day.

## Facebook post drafts
**Packing -> Make a post** builds plain text from the packing list (or nursery stock) and current prices. Toggles: emojis, limited numbers, new this week, your own pickup note, "Message us to hold plants". Copy or Share, plus a short Marketplace version. Nothing leaves the device.

## Hosting on GitHub Pages
1. Upload the contents of this `app` folder to a GitHub repository's root.
2. **Settings -> Pages**: main branch, `/ (root)`.
3. Open `https://parris-tech-services.github.io/myrtle-creek-nursery/` in Safari and add it to the Home Screen.
4. After any change, bump `VERSION` in `sw.js` and `APP_VERSION` in `js/version.js` to the same new value so devices pick up the update.

## For developers
Plain HTML, CSS and JavaScript modules, no build step. Libraries are in `vendor/` (Dexie, PapaParse) and the title font Bagel Fat One (SIL Open Font License, `vendor/OFL-bagel-fat-one.txt`). Run the tests with `node --test tests/*.test.mjs`. Serve with `Cache-Control: no-store` while developing.

## Quality checks
- `npm ci`
- `npm run check` - JavaScript lint and unit/integration tests
- `npm run test:browser` - Playwright browser checks
- `npm run version:bump -- mcn-v26` - keep the service-worker and app versions in step
