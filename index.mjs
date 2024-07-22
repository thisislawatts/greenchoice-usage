import "dotenv/config";
import puppeteer from "puppeteer";
import { addDays, format, parse, subDays } from "date-fns";
import debug from "debug";

const logger = debug("greenchoice.usage");

// Configuration
const USER_EMAIL = process.env.GC_USER_EMAIL;
const USER_PASSWORD = process.env.GC_USER_PASSWORD;
const TARGET_DATE = process.env.GC_TARGET_DATE;

const dateFormatString = "yyyy-MM-dd";
const d = TARGET_DATE
  ? parse(TARGET_DATE, dateFormatString, new Date())
  : subDays(new Date(), 1);

console.log(
  `🚀 Starting GreenChoice scraper for ${format(d, dateFormatString)}`
);

let cookie = null;

// Launch the browser and open a new blank page
const browser = await puppeteer.launch({
  headless: true, // Toggle this for debugging
});

const page = await browser.newPage();

await page.goto("https://mijn.greenchoice.nl/verbruik");

// Fill out the login form
try {
  await page.locator("#Username").fill(USER_EMAIL);
  await page.locator("#Password").fill(USER_PASSWORD);
} catch (err) {
  throw new Error("Could not find login form fields");
}

// Listen for all network requests
await page.setRequestInterception(true);
page.on("request", (request) => {
  request.continue();
});

page.on("response", async (response) => {
  try {
    const requestHeaders = response.request().headers();

    // Check if the response is from an XHR request
    if (response.request().resourceType() === "xhr") {
      logger(`XHR URL: ${response.request().url()}`);

      if (requestHeaders.cookie) {
        logger(`Found cookie`, requestHeaders.cookie);
        cookie = requestHeaders.cookie;
      }
    }
  } catch (error) {
    console.error(`Error processing response: ${error}`);
  }
});

await page.evaluate(() => {
  document.querySelector("#SubmitLoginForm").click();
});

// Wait for the page to load
await page.locator("text/Chloe").waitHandle();

if (!cookie) {
  throw new Error("No cookie extracted from login. Unable to proceeed");
}

logger(`Query GreenChoice API directly using captured cookie`);
const jsonBody = await fetchConsumptionData(
  cookie,
  subDays(d, 4),
  addDays(d, 2)
);

// Example of the data structure
// is available in ./sample-consumption-data.json
const data = jsonBody.entries.find(
  (entry) => entry.productType === "netConsumption"
);

if (!data) {
  throw new Error("No Net Consumption Product Type found");
}

if (Object.values(data.values).length === 0) {
  console.log(data);
  throw new Error("No values found in the data");
}

for (const dayStampString in data.values) {
  logger(`Checking ${dayStampString} includes ${format(d, dateFormatString)}`);
  if (dayStampString.includes(format(d, dateFormatString))) {
    // Yesterdays cost
    const yesterdayCost = data.values[dayStampString].costsTotal;
    const dayPrevious =
      data.values[format(subDays(d, 1), dateFormatString) + "T00:00:00+02:00"]
        .costsTotal;

    const comparison =
      yesterdayCost > dayPrevious
        ? "📈 This is more than the day before"
        : "📉 This is less than the day before";

    console.log(
      `Yesterday we spent ${formatMoney(yesterdayCost)} on electricity and gas.
${comparison} (${formatMoney(dayPrevious)})`
    );
  }
}

await browser.close();

function formatMoney(num) {
  return Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  })
    .format(num)
    .replace("€", "€");
}

async function fetchConsumptionData(authCookie, start, end) {
  const url = `https://mijn.greenchoice.nl/api/consumption?interval=day&start=${format(
    start,
    dateFormatString
  )}&end=${format(end, dateFormatString)}`;

  logger(`Fetching data from ${url}`);

  const res = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      cookie: authCookie,
    },
  });

  return await res.json();
}
