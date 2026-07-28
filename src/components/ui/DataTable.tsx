import type { ReactNode } from "react";
import { Spinner } from "./Spinner";

export interface ColumnDef<T> {
  header: string;
  accessor: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  rows: T[];
  getRowId: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  // Legacy action-button props kept for backward-compat outside session logs
  onView?: (row: T) => void;
  onEdit?: (row: T) => void;
  onDelete?: (row: T) => void;
  deleteLabel?: string;
  emptyMessage?: string;
  loading?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  onRowClick,
  onView,
  onEdit,
  onDelete,
  deleteLabel = "Delete",
  emptyMessage = "No records found.",
  loading = false,
}: DataTableProps<T>) {
  const hasActions = Boolean(onView || onEdit || onDelete);

  return (
    <div className="overflow-x-auto rounded-xl border border-navy-100 shadow-sm">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-navy-700">
            {columns.map((col) => (
              <th
                key={col.header}
                className="px-4 py-2.5 text-left text-xs font-semibold text-navy-100 uppercase tracking-wide whitespace-nowrap"
              >
                {col.header}
              </th>
            ))}
            {hasActions && (
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-navy-100 uppercase tracking-wide">Actions</th>
            )}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td
                colSpan={columns.length + (hasActions ? 1 : 0)}
                className="px-4 py-8 text-center"
              >
                <div className="flex items-center justify-center gap-2 text-navy-300 text-sm">
                  <Spinner /> Loading…
                </div>
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length + (hasActions ? 1 : 0)}
                className="px-4 py-8 text-center text-navy-300"
              >
                {emptyMessage}
              </td>
            </tr>
          )}
          {!loading &&
            rows.map((row, i) => (
              <tr
                key={getRowId(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`transition-colors border-b border-navy-50 last:border-b-0 ${
                  i % 2 === 0 ? "bg-white" : "bg-slate-50/60"
                } ${onRowClick ? "cursor-pointer hover:bg-sky-50/40" : "hover:bg-navy-50/40"}`}
              >
                {columns.map((col) => (
                  <td key={col.header} className={`px-4 py-2.5 text-navy-600 text-sm ${col.className ?? ""}`}>
                    {col.accessor(row)}
                  </td>
                ))}
                {hasActions && (
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex justify-end gap-3 text-sm font-medium">
                      {onView && (
                        <button onClick={(e) => { e.stopPropagation(); onView(row); }} className="text-sky-400 hover:text-sky-500">
                          View
                        </button>
                      )}
                      {onEdit && (
                        <button onClick={(e) => { e.stopPropagation(); onEdit(row); }} className="text-navy-500 hover:text-navy-700">
                          Edit
                        </button>
                      )}
                      {onDelete && (
                        <button onClick={(e) => { e.stopPropagation(); onDelete(row); }} className="text-red-500 hover:text-red-700">
                          {deleteLabel}
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
