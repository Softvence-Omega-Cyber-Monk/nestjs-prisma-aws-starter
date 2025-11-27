import { simplifyError } from './handle-error.simplify';

export function HandleError(customMessage?: string, record?: string) {
  return function <T>(
    _target: T,
    _propertyName: string,

    descriptor: TypedPropertyDescriptor<(...args: unknown[]) => Promise<any>>,
  ) {
    const method = descriptor.value;

    if (!method) return;

    descriptor.value = async function (
      ...args: Parameters<typeof method>
    ): Promise<ReturnType<typeof method>> {
      try {
        return await method.apply(this, args);
      } catch (error) {
        simplifyError(error, customMessage, record);
      }
    };
  };
}
