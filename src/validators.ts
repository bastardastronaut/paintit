import { Request, Response, NextFunction } from "express";
import { dataLength } from "ethers";
import { FORBIDDEN_COMBINATIONS } from "./spellCheck";

type Validator = (input?: string, isOptional?: boolean) => boolean;
const validateHexString = (input: string, targetLength: number) => {
  try {
    if (dataLength(input) !== targetLength) return false;

    return true;
  } catch (e) {
    return false;
  }
};

export const isValidIdentity: Validator = (
  input?: string,
  isOptional = false
) => {
  if (input === undefined) return isOptional;
  return validateHexString(input, 20);
};

export const isValidHash: Validator = (input?: string, isOptional = false) => {
  if (input === undefined) return isOptional;
  return validateHexString(input, 32);
};

export const isValidSignature: Validator = (
  input?: string,
  isOptional = false
) => {
  if (input === undefined) return isOptional;
  return validateHexString(input, 65);
};

export const isValidNumber =
  (
    {
      isOptional = false,
      min,
      max,
    }: {
      min?: number;
      max?: number;
      isOptional?: boolean;
    } = { isOptional: false }
  ): Validator =>
  (input?: string) => {
    if (input === undefined) return isOptional;
    const value = parseInt(input, 10);
    if (isNaN(value)) return false;
    if (min && value < min) return false;
    if (max && value > max) return false;

    return true;
  };

export const isAlphanumeric =
  (
    {
      isOptional = false,
      maxLength,
    }: {
      maxLength?: number;
      isOptional?: boolean;
    } = { isOptional: false }
  ): Validator =>
  (input?: string) => {
    if (input === undefined || input.length === 0) return isOptional;
    if (maxLength && input.length > maxLength) return false;

    return (
      !!input.match(/^[a-z0-9]+$/i) &&
      !FORBIDDEN_COMBINATIONS.includes(input.toLowerCase())
    );
  };

type ValueAccessor = ({
  params,
  body,
}: {
  params: any;
  body: any;
}) => string | undefined;

export const middleware =
  (validators: [Validator, ValueAccessor][]) =>
  (req: Request, res: Response, next: NextFunction) => {
    for (const [validator, valueAccessor] of validators) {
      if (!validator(valueAccessor({ params: req.params, body: req.body }))) {
        return res.sendStatus(400);
      }
    }

    next();
  };
