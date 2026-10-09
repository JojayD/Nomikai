import { BadRequestException } from '@nestjs/common';

export function pageNumber(
  value: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  const number = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(number) ||
    number < minimum
  ) {
    throw new BadRequestException(
      'Pagination requires non-negative whole numbers; limit must be positive.',
    );
  }
  return Math.min(number, maximum);
}
