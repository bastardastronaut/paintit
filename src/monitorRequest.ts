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

const monitorRequest =
  (clock: Clock) => (req: Request, res: Response, next: NextFunction) => {
    // requests are reset every 5 minutes
    // policy:     GET requests -> 500 / 5 minutes / IP
    // POST/PUT/DELETE requests -> 50 / 5 minutes / IP
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
      (requestType === RequestType.Read && requestCount > 500) ||
      (requestType === RequestType.Mutate && requestCount > 50) ||
      (requestType === RequestType.Create && requestCount > 5)
    )
      throw new TooManyRequestsError(
        `too many ${RequestType[requestType]} requests from ${ip}`
      );

    requestTypeMap.set(ip, requestCount + 1);

    clock.in(300).then(() => {
      const requestCount = requestTypeMap.get(ip) || 0;
      if (requestCount < 2) requestTypeMap.delete(ip);
      else requestTypeMap.set(ip, requestCount - 1);
    });

    next();
  };

export default monitorRequest;
