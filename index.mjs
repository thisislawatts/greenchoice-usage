import "dotenv/config";
import puppeteer from "puppeteer";
import { addDays, format, parse, subDays } from "date-fns";

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
  headless: true,
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
    const responseHeaders = response.headers();

    // Check if the response is from an XHR request
    if (response.request().resourceType() === "xhr") {
      //   console.log(`XHR URL: ${url}`);

      if (requestHeaders.cookie) {
        // console.log(`Found cookie`);
        cookie = requestHeaders.cookie;
      }

      // Extract cookies from the 'set-cookie' header, if present
      if (responseHeaders["set-cookie"]) {
        // console.log("Cookies:", cookies);
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

if (cookie) {
  //   console.log(`Query API directly using captured cookie`);
  const res = await fetch(
    `https://mijn.greenchoice.nl/api/consumption?interval=day&start=${format(
      subDays(d, 4),
      dateFormatString
    )}&end=${format(addDays(d, 2), dateFormatString)}`,
    {
      headers: {
        accept: "application/json, text/plain, */*",
        cookie,
      },
    }
  );

  const jsonBody = await res.json();

  const data = jsonBody.entries.find(
    (entry) => entry.productType === "netConsumption"
  );

  if (!data) {
    throw new Error("No Net Consumption Product Type found");
  }

  for (const dayStampString in data.values) {
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
        `Yesterday we spent ${formatMoney(
          yesterdayCost
        )} on electricity and gas.
${comparison} (${formatMoney(dayPrevious)})`
      );
    }
  }
}

await browser.close();

function formatMoney(num) {
  return Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(num).replace("€", "€");
}
