import type { ProjectFileTreeNode } from "../../../shared/types"

export function filterFileTree(items: ProjectFileTreeNode[], query: string): ProjectFileTreeNode[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return items

  return items.reduce<ProjectFileTreeNode[]>((filteredItems, item) => {
    const matchesName = item.name.toLowerCase().includes(normalized)
    const filteredChildren =
      item.type === "directory" && item.children ? filterFileTree(item.children, normalized) : []

    if (matchesName || filteredChildren.length > 0) {
      filteredItems.push({
        ...item,
        children: filteredChildren,
      })
    }

    return filteredItems
  }, [])
}

export function collectExpandedDirectoryPaths(items: ProjectFileTreeNode[]): string[] {
  const paths: string[] = []

  const visit = (nodes: ProjectFileTreeNode[]) => {
    nodes.forEach((node) => {
      if (node.type === "directory" && node.children && node.children.length > 0) {
        paths.push(node.path)
        visit(node.children)
      }
    })
  }

  visit(items)
  return paths
}
