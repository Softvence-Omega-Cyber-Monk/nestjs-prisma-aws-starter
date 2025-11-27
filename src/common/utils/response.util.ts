export type TResponse<T = unknown> = {
  success: boolean;
  message: string | string[];
  data: T;
};

export type TPaginatedResponse<T = unknown> = {
  success: boolean;
  message: string | string[];
  data: T[];
  metadata: {
    page: number;
    limit: number;
    total: number;
    totalPage: number;
  };
};

export const successResponse = <T>(
  data: T,
  message = 'Request Success',
): TResponse<T> => ({
  success: true,
  message,
  data,
});

export const successPaginatedResponse = <T>(
  data: T[],
  metaData: {
    page: number;
    limit: number;
    total: number;
  },
  message = 'Request Success',
): TPaginatedResponse<T> => ({
  success: true,
  message,
  data,
  metadata: {
    page: metaData.page,
    limit: metaData.limit,
    total: metaData.total,
    totalPage: Math.ceil(metaData.total / metaData.limit),
  },
});

export const errorResponse = <T>(
  data: T,
  message = 'Request Failed',
): TResponse<T> => ({
  success: false,
  message,
  data,
});
