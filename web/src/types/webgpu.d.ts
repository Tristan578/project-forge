/** Minimal WebGPU type declarations for navigator.gpu usage */
interface GPU {
  requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
}

interface GPURequestAdapterOptions {
  powerPreference?: 'low-power' | 'high-performance';
}

interface GPUAdapter {
  requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
}

interface GPUDeviceDescriptor {
  label?: string;
}

interface GPUDevice {
  destroy(): void;
}

interface Navigator {
  readonly gpu: GPU;
}
