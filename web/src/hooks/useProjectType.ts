import { useEditorStore } from '@/stores/editorStore';

export function useProjectType() {
  const projectType = useEditorStore((s) => s.projectType);

  return {
    is2D: projectType === '2d',
    is3D: projectType === '3d',
    projectType,
    canCreate: (entityType: string) => {
      if (projectType === '2d') {
        return ['sprite', 'camera2d'].includes(entityType);
      }
      return !['sprite', 'camera2d'].includes(entityType);
    },
  };
}
