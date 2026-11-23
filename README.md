# Myrtle Creek Nursery - market till and stock app

Works offline on an iPhone or iPad. Everything is saved on the device the moment you tap, so there is no Save button. Each device keeps its own data (no live sync between devices), so use one device per market and combine the backups afterwards.

## Install on iPhone or iPad
1. Open the app's web address in **Safari**.
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. From now on, **always open the app from the Home Screen icon**.

Why: Safari wipes website data for sites that have not been opened for about 7 days, unless the site is installed to the Home Screen. The app shows a banner if you open it in a Safari tab instead of the icon, or if the device has not agreed to keep the data safe. The Backup screen shows whether storage is protected.

Open the app once with wifi before your first market so it can download itself for offline use.

## A normal market day
1. **Packing**: check the suggested quantities for the market (last sold x 1.2, extra if something sold out, plus held orders). Edit if you like.
2. **Market day -> Start market day**: pick the date and place, then count the opening cash float by notes and coins. It is prefilled from the float you chose to keep last time.
3. **Load stock**: confirm what you took. This comes off nursery stock.
4. **Sell**: tap products, tap **Pay**, pick Cash, Card or Transfer / PayID (Split payment is underneath). Deals are applied automatically and the best price for the customer wins. Use **Edit** on a line for seconds or a discount, **Other item** for odd things, **Sold out** to log the time something ran out, and **Undo** (shown for 10 seconds after each sale) or **Undo last sale**.
5. **Orders here** (on Sell) shows held orders for this market, with a quick **Mark collected**.
6. During the day use **Record loss**, **Cash out / expense** (fuel, supplies, or cash you borrowed from the float) and **Weather & stall fee**.
7. **End day: check the takings** is a guided 4 steps: count what is coming home (taken minus coming home should equal sold plus lost), count the cash (notes and coins, optional float to keep for next market), check card and Transfer / PayID totals against the terminal and bank, then the summary and **Close day**. Closing can be undone.

## Orders (holds, pickups, drop-offs)
- Each order has a customer, items, how it will be handed over, a due date, a payment status (unpaid, part-paid, paid) and a fulfilment status (held, collected or delivered, cancelled).
- Held items are reserved. The Nursery screen shows on hand, held and available.
- A payment counts as money received on the day it was taken, and counts toward the open market day's cash, card and transfer / PayID totals.
- Units count as sold on the day the order is collected, so money is never counted twice. Prepaid orders not yet collected show as a liability on the Orders and Reports screens.
- Collecting at a market uses the stock you loaded. Collecting at Pambula or delivering takes the plants off nursery stock at that moment.

## Backup routine (do this after every market)
1. **Backup** tab, then **Export full backup**. On iPhone/iPad the share sheet opens: save to Files / Google Drive, email it to yourself, or AirDrop it.
2. The app shows a banner whenever a market day has been closed since the last backup.
3. To combine two devices, on one device choose **Merge another file** and pick the other device's backup. Rows are matched by id, so nothing doubles up. **Restore** replaces everything on the device.
4. The app also keeps its last 5 automatic snapshots on the device (and takes one before every import). If an import goes wrong, restore a snapshot from the Backup tab.

You can also export CSV files (sales lines, orders, cash counts) for spreadsheets.

## Google Sheet backup (optional, recommended)
Every sale, order, loss, stock change, price and setting is copied to your own Google Sheet whenever the device has signal, and the app only treats something as backed up once the sheet confirms it. The header shows **All backed up**, **3 waiting for signal** or **Sync error (tap)**. You can restore a device from the sheet (Backup tab).

1. Open the copy link you were given and tap **Make a copy**.
2. In your copy: **Extensions -> Apps Script -> Deploy -> New deployment -> Web app**. Execute as **Me**, Who has access **Anyone**, then **Deploy**.
3. Approve the permissions. If Google says **"Google hasn't verified this app"**, tap **Advanced**, then **Go to ... (unsafe)**. That is normal: it is your own copy of the script.
4. Copy the web app URL and open it in a browser, or in the Sheet use the menu **Myrtle Creek -> Show connection code**.
5. Copy the code.
6. In the app: **Backup -> Connect Google Sheet**, paste the code. It says "Connected" and starts syncing.

The sheet creates its own tabs. The last column of each tab (json) holds the full record, so nothing is lost on restore. Keep the code private: anyone who has it can read and write the sheet through the script. The code page hides the code once the app has connected; the Sheet menu can always show it again to you.

## Keeping your data safe
- **Never delete the Home Screen icon.** Deleting it deletes all the data on that device.
- **Never use "Clear History and Website Data"** in Safari settings.
- Carry a **power bank** on market days.
- A new version of the app never swaps in while a market day is open. When an update is ready the app says so; tap **Install update** after you close the day (a safety snapshot is taken first).
- A red banner appears if more than 2 market days have closed with no successful sync and no export.

## Changing prices, products and places
**Prices** tab: pricing groups (price each and multi-buy deals such as "4 for 15, 10 for 35"), types, products (variety, sub-category, own price for trees) and locations. Deals mix varieties within the same pricing group. Each sale keeps the price it was sold at, so later price changes never alter old sales.

## Hosting on GitHub Pages
1. Create a GitHub repository and upload the contents of this `app` folder to its root (`index.html` at the top level).
2. Repository **Settings -> Pages**, choose the main branch and `/ (root)`, save.
3. After a minute the site is at `https://YOUR-NAME.github.io/REPO-NAME/`. Open that in Safari and add it to the Home Screen.
4. When you change any file, edit `VERSION` at the top of `sw.js` (for example `mcn-v2`) so devices pick up the update. Open the app twice to load it.

## For the curious
Plain HTML, CSS and JavaScript modules, no build step. Libraries are copied into `vendor/` (Dexie, dexie-export-import, PapaParse) and the title font Bagel Fat One (SIL Open Font License, see `vendor/OFL-bagel-fat-one.txt`). Run the tests with `node --test tests/*.test.mjs`.

## Facebook post drafts
**Packing -> Make a post** builds plain text for Facebook or Marketplace from the packing list (or nursery stock if there is no list) and the current prices: prices first, varieties grouped by sub-category, limited numbers and what is new. Toggles for emojis, limited numbers, new this week, a pickup note (off, and empty, until you type your own) and "Message us to hold plants" (off). Copy or Share, plus a short Marketplace version. Nothing leaves the device.

## Owner's one-time template steps (for whoever makes the shared copy link)
1. Create a new empty Google Sheet and name it, for example, "Myrtle Creek Backup".
2. **Extensions -> Apps Script**, replace the sample code with the contents of `apps-script.gs`, and save. Do not deploy: copies make their own deployment.
3. Share the Sheet's link with **/edit** at the end changed to **/copy** (https://docs.google.com/spreadsheets/d/SHEET-ID/copy). Anyone who opens it gets a "Make a copy" button.
