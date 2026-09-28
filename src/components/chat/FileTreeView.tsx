import { Folder, File } from "lucide-react";
import { useT } from "../../i18n";

type TreeNode = { [key: string]: TreeNode | null };

export const FILE_TREE_VIEW_LIMITS = {
  maxPaths: 400,
  maxDepth: 24,
  maxPathChars: 240,
  maxNameChars: 120,
} as const;

export function normalizeFileTreePaths(content: string): {
  paths: string[];
  omitted: number;
} {
  const paths: string[] = [];
  let omitted = 0;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line === "(empty)") continue;
    if (paths.length >= FILE_TREE_VIEW_LIMITS.maxPaths) {
      omitted++;
      continue;
    }

    const parts = line
      .slice(0, FILE_TREE_VIEW_LIMITS.maxPathChars)
      .split("/")
      .filter(Boolean)
      .slice(0, FILE_TREE_VIEW_LIMITS.maxDepth)
      .map((part) =>
        part.length > FILE_TREE_VIEW_LIMITS.maxNameChars
          ? `${part.slice(0, FILE_TREE_VIEW_LIMITS.maxNameChars)}…`
          : part,
      );

    if (parts.length > 0) {
      paths.push(parts.join("/"));
    }
  }

  return { paths, omitted };
}

export function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = {};
  for (const p of paths) {
    const parts = p.trim().split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        node[part] = null;
      } else {
        node[part] = (node[part] as TreeNode) || {};
        node = node[part] as TreeNode;
      }
    }
  }
  return root;
}

function sortEntries(
  entries: [string, TreeNode | null][],
): [string, TreeNode | null][] {
  return entries.sort(([, a], [, b]) => {
    if (a !== null && b === null) return -1;
    if (a === null && b !== null) return 1;
    return 0;
  });
}

function TreeNodeRow({
  name,
  node,
  depth,
}: {
  name: string;
  node: TreeNode | null;
  depth: number;
}) {
  const isDir = node !== null;
  return (
    <>
      <div
        className="flex items-center gap-1.5 py-0.5"
        style={{ paddingLeft: depth * 14 }}
      >
        {isDir ? (
          <Folder size={12} className="text-yellow-500 shrink-0" />
        ) : (
          <File size={12} className="text-muted-foreground shrink-0" />
        )}
        <span className="text-xs font-mono text-foreground/80">{name}</span>
      </div>
      {isDir &&
        sortEntries(Object.entries(node!)).map(([childName, childNode]) => (
          <TreeNodeRow
            key={childName}
            name={childName}
            node={childNode}
            depth={depth + 1}
          />
        ))}
    </>
  );
}

interface FileTreeViewProps {
  content: string;
}

export function FileTreeView({ content }: FileTreeViewProps) {
  const t = useT();
  const { paths, omitted } = normalizeFileTreePaths(content);

  if (paths.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {t.tool.emptyFileTree}
      </span>
    );
  }

  const tree = buildTree(paths);

  return (
    <div className="py-0.5">
      {sortEntries(Object.entries(tree)).map(([name, node]) => (
        <TreeNodeRow key={name} name={name} node={node} depth={0} />
      ))}
      {omitted > 0 && (
        <div className="px-1 py-0.5 text-xs text-muted-foreground">
          … {t.tool.morePathsOmitted.replace("{count}", String(omitted))}
        </div>
      )}
    </div>
  );
}
