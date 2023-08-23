import { Request, Response, NextFunction } from "express";
import { TooManyRequestsError } from "./errors";
import Clock from "./modules/clock";
import requestIp from "request-ip";

export enum RequestType {
  Read,
  Mutate,
  Create,
}

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
      (requestType === RequestType.Read && requestCount > 100) ||
      (requestType === RequestType.Mutate && requestCount > 50) ||
      (requestType === RequestType.Create && requestCount > 5)
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

    setTimeout(
      next,
      Math.pow(
        2,
        requestCount -
          (requestType === RequestType.Read
            ? 24
            : requestType === RequestType.Mutate
            ? 10
            : 5)
      ) * 1000
    );
  };

export default monitorRequest;
