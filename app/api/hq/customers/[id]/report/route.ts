import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  const { data: allowed } = await supabase.rpc("has_staff_permission", {
    p_permission: "customers.view_metadata",
  });
  if (!allowed)
    return NextResponse.json(
      { error: "Customer metadata permission required." },
      { status: 403 },
    );
  const [
    { data: profile, error },
    { data: operations, error: operationsError },
  ] = await Promise.all([
    supabase.rpc("staff_customer_360", { p_customer_id: id }),
    supabase.rpc("staff_customer_operational_detail", { p_customer_id: id }),
  ]);
  if (error || operationsError)
    return NextResponse.json(
      { error: "Customer report could not be prepared." },
      { status: 500 },
    );
  if (!profile)
    return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  const customer = { ...profile, ...operations };
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Trade Police HQ";
  const overview = workbook.addWorksheet("Overview");
  overview.columns = [
    { header: "Field", key: "field", width: 24 },
    { header: "Value", key: "value", width: 48 },
  ];
  overview.addRows([
    { field: "Customer ID", value: customer.customer_id },
    { field: "Name", value: customer.display_name },
    { field: "Email", value: customer.email },
    { field: "Plan", value: customer.plan },
    { field: "Status", value: customer.subscription_status },
    { field: "Member Since", value: customer.created_at },
    { field: "Last Activity", value: customer.last_activity_at },
    { field: "Analyses", value: customer.analysis_count },
    { field: "Open Trades", value: customer.open_trades },
    { field: "Closed Trades", value: customer.closed_trades },
  ]);
  for (const [name, rows, columns] of [
    [
      "Trading Accounts",
      customer.accounts ?? [],
      ["name", "broker", "type", "currency", "active"],
    ],
    [
      "Strategies",
      customer.strategies ?? [],
      [
        "name",
        "active",
        "trading_style",
        "maximum_risk_percent",
        "minimum_rr",
        "confidence_threshold",
        "created_at",
      ],
    ],
    [
      "Analyses",
      customer.analyses ?? [],
      ["instrument", "direction", "confidence", "outcome", "created_at"],
    ],
    [
      "Trades",
      customer.trades ?? [],
      [
        "instrument",
        "direction",
        "entry",
        "stop_loss",
        "take_profit",
        "status",
        "opened_at",
        "closed_at",
        "outcome",
        "result_r",
      ],
    ],
    [
      "Activity Timeline",
      customer.timeline ?? [],
      ["type", "title", "detail", "created_at"],
    ],
  ] as [string, any[], string[]][]) {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = columns.map((key) => ({
      header: key.replaceAll("_", " ").replace(/\b\w/g, (x) => x.toUpperCase()),
      key,
      width: key === "detail" ? 50 : 22,
    }));
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
      from: "A1",
      to: `${String.fromCharCode(64 + columns.length)}1`,
    };
  }
  overview.getRow(1).font = { bold: true };
  overview.views = [{ state: "frozen", ySplit: 1 }];
  const buffer = await workbook.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="trade-police-customer-${id}-${date}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
