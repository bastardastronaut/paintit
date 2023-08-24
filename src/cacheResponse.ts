import { Request, Response, NextFunction } from "express";
export default () => {
  const cache = new Map<string, any>();

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") return next();

    console.log(req.url);

    next();
  };

  return {
    middleware,
    set: cache.set,
    invalidate: cache.delete,
  };
};
