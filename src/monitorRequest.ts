import { Request, Response, NextFunction } from "express";
import { TooManyRequestsError } from "./errors";
import Clock from "./modules/clock";
import requestIp from "request-ip";

import { RATE_LIMIT_READ, RATE_LIMIT_MUTATE, RATE_LIMIT_CREATE } from './consts'

export enum RequestType {
  Read,
  Mutate,
  Create,
}

const METRICS = {
  [RequestType.Read]: RATE_LIMIT_READ,
  [RequestType.Mutate]: RATE_LIMIT_MUTATE,
  [RequestType.Create]: RATE_LIMIT_CREATE,
};

export const requests = new Map<RequestType, Map<string, number>>([
  [RequestType.Read, new Map()],
  [RequestType.Mutate, new Map()],
  [RequestType.Create, new Map()],
]);

/*
 * what you really want is
 * global request / second MAX 10
 * for IPs request / minute MAX 100
 * */

const blacklist = new Set<string>();

const monitorRequest =
  (clock: Clock) => (req: Request, res: Response, next: NextFunction) => {
    // requests are reset every 1 minute
    // policy:     GET requests -> 100 / 1 minute / IP
    // POST/PUT/DELETE requests -> 50 / 1 minute / IP
    // CREATE

    // read existing dataset

    const requestType = req.url.includes("create-account")
      ? RequestType.Create
      : req.method === "GET"
      ? RequestType.Read
      : RequestType.Mutate;

    const ip = requestIp.getClientIp(req) || "";

    const requestTypeMap = requests.get(requestType);
    if (!requestTypeMap) throw new Error("request type not found");

    if (!ip) {
      console.log("IP could not be identified");
      return next();
    }

    let requestCount = requestTypeMap.get(ip) || 0;

    console.log(`[${ip}]: ${requestCount} ${req.method} ${req.url}`);

    if (
      blacklist.has(ip) ||
      (requestType === RequestType.Read &&
        requestCount > METRICS[RequestType.Read]) ||
      (requestType === RequestType.Mutate &&
        requestCount > METRICS[RequestType.Mutate]) ||
      (requestType === RequestType.Create &&
        requestCount > METRICS[RequestType.Create])
    ) {
      blacklist.add(ip);

      clock.in(60).then(() => {
        blacklist.delete(ip);
      });

      return res.sendStatus(429);
    }

    requestTypeMap.set(ip, requestCount + 1);

    clock.in(60).then(() => {
      const requestCount = requestTypeMap.get(ip) || 0;
      if (requestCount < 2) requestTypeMap.delete(ip);
      else requestTypeMap.set(ip, requestCount - 1);
    });

    next()

    /*
    const penalty =
      requestCount -
      (requestType === RequestType.Read
        ? METRICS[RequestType.Read] / 2
        : requestType === RequestType.Mutate
        ? METRICS[RequestType.Mutate] / 2
        : METRICS[RequestType.Create] / 2);

    if (penalty > 0) {
      clock.in(penalty).then(next);
    } else {
      next();
    }*/
  };

export default monitorRequest;
