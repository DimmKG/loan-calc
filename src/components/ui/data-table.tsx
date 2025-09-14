"use client"
 
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  InitialTableState,
  Row,
  TableMeta,
  useReactTable,
  Cell as TableCellType,
} from "@tanstack/react-table"
 
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ScrollArea } from "./scroll-area"
import { CSSProperties, ReactNode } from "react"
 
interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  meta?: TableMeta<TData> & {
    getRowStyles?: (row: Row<TData>) => CSSProperties & { className?: string }
    getCellSuffix?: (cell: TableCellType<TData, unknown>) => ReactNode
  }
  initialState?: InitialTableState
}
 
export function DataTable<TData, TValue>({
  columns,
  data,
  meta,
  initialState,
}: DataTableProps<TData, TValue>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    meta,
    initialState,
  })
 
  return (
    <div className="overflow-hidden rounded-md border h-full w-full">
      <ScrollArea className="h-full">
        <Table>
          <TableHeader className="sticky top-0 bg-secondary">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={meta?.getRowStyles(row)?.className}
                  data-state={row.getIsSelected() && "selected"}
                  style={meta?.getRowStyles(row)} 
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <div className="flex items-center gap-2">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        {meta?.getCellSuffix?.(cell)}
                      </div>
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  )
}