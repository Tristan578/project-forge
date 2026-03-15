import { toast } from 'sonner';

export function showError(message: string): void {
  toast.error(message);
}

export function showSuccess(message: string): void {
  toast.success(message);
}

export function showInfo(message: string): void {
  toast(message);
}
