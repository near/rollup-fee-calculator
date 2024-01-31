import { DuneClient } from "@cowprotocol/ts-dune-client";
import { createClient } from "redis";
import * as dotenv from "dotenv";
import * as http from "http";
import axios from "axios";

// dotenv.config({ path: __dirname + "/.env" });
const DUNE_API_KEY = process.env.DUNE_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;
const COIN_API_KEY = process.env.COIN_API_KEY;
const client = new DuneClient(DUNE_API_KEY ?? "");
const port = process.env.PORT || 3000;
const queryID = 3369073;
const cost_per_4mb = 0.00515;
const cost_per_1mb = 0.00287;

async function sendQuery(queryID: number) {
  const executionResult = await client.refresh(queryID);
  return executionResult.result?.rows;
}

async function putInRedis() {
  const redisClient = await createClient({
    url: REDIS_URL,
    port: 6379,                 
    password: REDIS_PASSWORD,
  })
    .on("error", (err) => console.log("Redis Client Error", err))
    .connect();
  const result = await sendQuery(queryID);
  if (!result) {
    console.log("No result");
    return;
  }
  let weeklyPrices = (await getNearWeeklyPrice()).data;
  for (let i = 0; i < result.length; i++) {
    for (let a = 0; a < weeklyPrices.length; a++) {
      let redisJson = JSON.parse(JSON.stringify([result[i]]));
      let name = result[i].name as string;
      if (
        checkIfInBetween(
          weeklyPrices[a].time_period_start as string,
          weeklyPrices[a].time_period_end as string,
          result[i].week as string
        )
      ) {
        let weekly_approx_near_price =
          (weeklyPrices[a].rate_high + weeklyPrices[a].rate_low) / 2;
        let weekly_approx_near_l2_calldata_cost_1mb =
          weekly_approx_near_price *
          cost_per_1mb *
          (result[i].calldata_mb as number);
        let weekly_approx_near_l2_calldata_cost_4mb =
          (weekly_approx_near_price *
            cost_per_4mb *
            (result[i].calldata_mb as number)) /
          4;
        redisJson[0].weekly_approx_near_l2_calldata_cost_1mb_usd =
          weekly_approx_near_l2_calldata_cost_1mb;
        redisJson[0].weekly_approx_near_l2_calldata_cost_4mb_usd =
          weekly_approx_near_l2_calldata_cost_4mb;
        let current = await getFromRedis(name);
        if (current) {
          let new_value = (JSON.parse(current) as string[]).concat(redisJson);
          await redisClient.set(name, JSON.stringify(new_value));
        } else {
          await redisClient.set(name, JSON.stringify(redisJson));
        }
      }
    }
  }
  redisClient.quit();
}

async function getFromRedis(name: string): Promise<string | null> {
  const redisClient = await createClient({
    url: REDIS_URL,
  })
    .on("error", (err) => console.log("Redis Client Error", err))
    .connect();
  return await redisClient.get(name);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/getByName")) {
    const urlParams = new URLSearchParams(req.url.slice(req.url.indexOf("?")));
    const name = urlParams.get("name");
    if (name) {
      const result = await getFromRedis(name);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(result);
    } else {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing name parameter");
    }
  } else if (req.method === "GET" && req.url === "/updateFees") {
    await putInRedis();
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Put in Redis triggered");
  } else if (req.method === "GET" && req.url === "/flushDb") {
    await flushDb();
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Redis flushed");
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});

async function flushDb() {
  const redisClient = await createClient({
    url: REDIS_URL,
  })
    .on("error", (err) => console.log("Redis Client Error", err))
    .connect();
  redisClient.flushAll();
  redisClient.quit();
}

async function getNearWeeklyPrice() {
  let config = {
    method: "get",
    maxBodyLength: Infinity,
    url: "https://rest.coinapi.io/v1/exchangerate/NEAR/USD/history",
    headers: {
      Accept: "application/json",
      "X-CoinAPI-Key": COIN_API_KEY,
    },
    params: {
      period_id: "7DAY",
      time_start: "2024-01-01T00:00:00",
      limit: 100,
    },
  };

  return await axios(config);
}
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

function checkIfInBetween(
  time_period_start: string,
  time_period_end: string,
  week: string
) {
  let start = Date.parse(time_period_start);
  let end = Date.parse(time_period_end);
  let week_date = parseWeekIntoDate(week);
  if (week_date > start && week_date < end) {
    return true;
  }
  return false;
}

function parseWeekIntoDate(week: string): number {
  week = week.substring(0, 10);
  return Date.parse(week);
}
