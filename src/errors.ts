import { Response } from 'express'
export class NotFoundError extends Error {}
export class BadRequestError extends Error {}
export class UnauthorizedError extends Error {}
export class TooManyRequestsError extends Error {}
export class UnprocessableEntityError extends Error {}

export default (res : Response, processor: Promise<any>) => {

}
