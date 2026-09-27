#!/usr/bin/env python3
"""Builds docs/business/financial-model.xlsx: an editable 24-month model for Wisecall with three scenarios.

Every number in the workbook that is not on the Inputs sheet is a FORMULA that points back to Inputs, so changing an input changes
everything. Run:  pip install openpyxl  &&  python3 docs/business/tools/build_financial_model.py
(Inputs marked PLACEHOLDER or [VERIFY] are assumptions to replace with your own quotes, not facts.)
"""
import os
from openpyxl import Workbook
from openpyxl.chart import LineChart, Reference
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName

OUT = os.path.join(os.path.dirname(__file__), '..', 'financial-model.xlsx')
MONTHS = 24
FIRST = 3  # first month column (C)

wb = Workbook()
bold = Font(bold=True)
title = Font(bold=True, size=14)
inp = PatternFill('solid', fgColor='FFF4CC')    # editable input
calc = PatternFill('solid', fgColor='EEF3F8')   # key result
head = PatternFill('solid', fgColor='25213B')
white = Font(bold=True, color='FFFFFF')
thin = Border(bottom=Side(style='thin', color='CCCCCC'))


def name(ws, cell, nm):
    col = ''.join(c for c in cell if c.isalpha())
    row = ''.join(c for c in cell if c.isdigit())
    wb.defined_names[nm] = DefinedName(nm, attr_text=f"'{ws.title}'!${col}${row}")


# ---------------------------------------------------------------- Inputs
ws = wb.active
ws.title = 'Inputs'
ws['A1'] = 'Wisecall financial model — INPUTS (yellow cells are editable)'
ws['A1'].font = title
ws['A2'] = 'All money in Georgian lari (₾) unless marked USD. Items marked PLACEHOLDER / [VERIFY] are assumptions to replace, not facts.'
for c, h in zip('ABCD', ['Parameter', 'Value', 'Unit', 'Source / what to check']):
    ws[f'{c}4'] = h
    ws[f'{c}4'].font = white
    ws[f'{c}4'].fill = head

GENERAL = [
    # (name, label, value, unit, source)
    ('FX', 'USD → GEL exchange rate', 2.70, '₾ per USD', '[VERIFY] National Bank of Georgia official rate: https://nbg.gov.ge/en/monetary-policy/currency'),
    ('FeePct', 'Platform fee (Wisecall’s share of each paid question)', 0.20, '%', 'Product setting PLATFORM_FEE_PERCENT (render.yaml, README)'),
    ('CardFeePct', 'Bank card acquiring fee (on every charged question)', 0.02, '%', '[VERIFY] BOG online payments reported at 2% (min 0.10 ₾) per integrals.ge; TBC not found; NBG draft law would cap merchant fees at 0.5% — ask your bank for the contract rate'),
    ('CardFeeBack', 'Is the card fee returned when a question is refunded? (1 = yes, 0 = no)', 0, '0/1', '[VERIFY] in the acquiring contract'),
    ('RefundRate', 'Refund rate (share of paid questions refunded: no answer in 7 days, rejected, complaints)', 0.08, '%', 'PLACEHOLDER — no data before launch; track it from the admin panel'),
    ('EmailsPerQ', 'Emails sent per paid question (new question, answer, reminders, ratings, sign-up)', 8, 'emails', 'Estimate from server/notify.js and server/ratings.js reminders'),
    ('ChecksPerApp', 'ID checks per mentor application (retries included)', 1.3, 'checks', 'PLACEHOLDER'),
    ('ReviewsPerApp', 'AI reviews per mentor application (re-runs included)', 1.5, 'reviews', 'PLACEHOLDER; the code caps it at AI_REVIEWS_PER_MENTOR_PER_DAY = 4'),
    ('RenderWebUSD', 'Render web service (Starter)', 7, 'USD / month', '[VERIFY] https://render.com/pricing — Starter $7 per search results; Render repriced in Sept 2026 per bex.co'),
    ('RenderDbUSD', 'Render Postgres (basic-256mb)', 6, 'USD / month', '[VERIFY] https://render.com/pricing — $6 compute per search results'),
    ('RenderStorageGB', 'Database storage', 5, 'GB', 'PLACEHOLDER'),
    ('RenderGBUSD', 'Render storage price', 0.30, 'USD / GB / month', '[VERIFY] https://render.com/pricing'),
    ('RenderUpgradeQ', 'Upgrade hosting when paid questions per month exceed', 1500, 'questions', 'PLACEHOLDER'),
    ('RenderUpgradeUSD', 'Extra hosting cost after the upgrade', 25, 'USD / month', '[VERIFY] next Render plan up'),
    ('ResendFreeEmails', 'Resend free emails per month', 3000, 'emails', 'Resend free plan (3,000/month, 100/day) — https://resend.com/pricing [VERIFY]'),
    ('ResendProUSD', 'Resend Pro plan (above the free tier)', 20, 'USD / month', 'Resend Pro $20 for 50,000 emails — https://resend.com/pricing [VERIFY]'),
    ('DiditFree', 'Didit free ID checks per month', 500, 'checks', 'Didit pricing page: 500 free per month — https://didit.me/pricing [VERIFY]'),
    ('DiditUSD', 'Didit price per full KYC check above the free tier', 0.33, 'USD', 'Didit pricing: $0.33 per full KYC (ID + liveness + face match) — https://didit.me/pricing [VERIFY]'),
    ('AIReviewUSD', 'Anthropic API cost per mentor review (Claude Sonnet 5, ~4k in / ≤3k out tokens)', 0.04, 'USD', 'List price $2 / $10 per million tokens → ≤ $0.038; the code also caps spend at AI_MONTHLY_BUDGET_USD (default 20)'),
    ('DomainYear', 'Domain wisecallge.ge (per year)', 60, '₾ / year', 'PLACEHOLDER [VERIFY] with your .ge registrar'),
    ('Accountant', 'Accountant', 300, '₾ / month', 'PLACEHOLDER [VERIFY WITH ACCOUNTANT] — ask for a quote'),
    ('BankMonthly', 'Bank account + acquiring monthly fees', 0, '₾ / month', 'PLACEHOLDER [VERIFY] with BOG / TBC'),
    ('OtherMonthly', 'Other monthly costs (tools, phone, …)', 50, '₾ / month', 'PLACEHOLDER'),
    ('LaunchOneOff', 'One-off launch costs in month 1 (lawyer review of the legal texts, company set-up)', 1500, '₾', 'PLACEHOLDER [VERIFY] — get a lawyer’s quote (docs/legal/README.md)'),
    ('VATRate', 'VAT rate', 0.18, '%', 'Georgian Tax Code, 18% — Andersen Georgia, legalese.ge [VERIFY WITH ACCOUNTANT]'),
    ('VATThreshold', 'VAT registration threshold (rolling 12 months)', 100000, '₾', 'Georgian Tax Code, 100,000 ₾ — Andersen Georgia [VERIFY WITH ACCOUNTANT]'),
    ('VATBase', 'VAT base: 1 = only Wisecall’s fee (agent model), 2 = the full question price (merchant model)', 1, '1 or 2', '[VERIFY WITH ACCOUNTANT] — the most important tax question for this model: with 2, VAT applies to all bookings once they pass 100,000 ₾ a year'),
    ('TurnoverTax', 'Turnover tax (e.g. 1% small-business status — individual entrepreneurs only)', 0, '%', '[VERIFY WITH ACCOUNTANT] — an LLC cannot use small-business status; keep 0 for an LLC'),
    ('ProfitTaxRate', 'Profit tax rate (Georgia taxes distributed profit)', 0.15, '%', '[VERIFY WITH ACCOUNTANT] 15% on distributed profit; Innovative Startup Status may reduce it (innovationstatus.gov.ge)'),
    ('DistributedShare', 'Share of monthly profit distributed as dividends', 0, '%', 'PLACEHOLDER — 0 means profits stay in the company and no profit tax is due'),
    ('GrantAmount', 'Grant received (e.g. GITA) — cash only, not revenue', 0, '₾', 'Set it to test the grant: docs/business/gita-grant/'),
    ('GrantMonth', 'Month the grant arrives', 4, 'month 1–24', 'PLACEHOLDER'),
    ('StartingCash', 'Cash you put in at the start', 0, '₾', 'PLACEHOLDER'),
]
r = 5
for key, label, val, unit, src in GENERAL:
    ws[f'A{r}'] = label
    ws[f'B{r}'] = val
    ws[f'B{r}'].fill = inp
    ws[f'C{r}'] = unit
    ws[f'D{r}'] = src
    if unit == '%':
        ws[f'B{r}'].number_format = '0.0%'
    name(ws, f'B{r}', key)
    r += 1

r += 1
ws[f'A{r}'] = 'SCENARIOS (each P&L sheet reads its own column)'
ws[f'A{r}'].font = bold
r += 1
for c, h in zip('ABCDE', ['Parameter', 'Slow', 'Base', 'Good', 'Note']):
    ws[f'{c}{r}'] = h
    ws[f'{c}{r}'].font = white
    ws[f'{c}{r}'].fill = head
SCEN_HEADER = r
SCEN = [
    ('Q1', 'Paid questions in month 1', (10, 20, 40), 'PLACEHOLDER — assumption, not a forecast'),
    ('Growth', 'Monthly growth of paid questions', (0.10, 0.15, 0.20), 'PLACEHOLDER'),
    ('QCap', 'Maximum paid questions per month', (1000, 2500, 5000), 'PLACEHOLDER — market-size ceiling'),
    ('Price', 'Average question price', (30, 40, 55), '₾ — mentors set 5–2000 ₾; see docs/business/competitors.md'),
    ('Apps', 'New mentor applications per month', (5, 10, 20), 'drives Didit + AI review costs'),
    ('Marketing', 'Marketing budget per month', (300, 500, 1000), '₾ — PLACEHOLDER'),
    ('Team', 'Team / founder pay per month', (0, 0, 0), '₾ — 0 = unpaid founders; add salaries to see the real break-even'),
]
SCEN_ROWS = {}
r += 1
for key, label, vals, note in SCEN:
    ws[f'A{r}'] = label
    for c, v in zip('BCD', vals):
        ws[f'{c}{r}'] = v
        ws[f'{c}{r}'].fill = inp
        if key == 'Growth':
            ws[f'{c}{r}'].number_format = '0%'
    ws[f'E{r}'] = note
    SCEN_ROWS[key] = r
    r += 1
ws.column_dimensions['A'].width = 78
ws.column_dimensions['B'].width = 12
ws.column_dimensions['C'].width = 16
ws.column_dimensions['D'].width = 110
ws.column_dimensions['E'].width = 60

# ---------------------------------------------------------------- P&L sheets
ROWS = [
    ('month', 'Month'),
    ('q', 'Paid questions'),
    ('gmv', 'Bookings charged (gross)'),
    ('refunds', 'Refunded to buyers'),
    ('netgmv', 'Net bookings (kept)'),
    ('mentors', 'Mentors’ share (paid out, not revenue)'),
    ('fee', 'Platform revenue (fee on net bookings)'),
    ('vatbase', 'VAT base (fee or net bookings, per Inputs)'),
    ('roll', 'Rolling 12-month VAT base (to previous month)'),
    ('vatflag', 'VAT registered this month? (1/0)'),
    ('vat', 'VAT due (prices include VAT)'),
    ('netrev', 'Net revenue after VAT'),
    ('card', 'Card fees'),
    ('gross', 'Gross margin'),
    ('_costs', 'COSTS'),
    ('render', 'Hosting (Render)'),
    ('email', 'Email (Resend)'),
    ('didit', 'ID checks (Didit)'),
    ('ai', 'AI reviews (Anthropic)'),
    ('domain', 'Domain'),
    ('acct', 'Accountant'),
    ('bank', 'Bank fees'),
    ('mkt', 'Marketing'),
    ('team', 'Team / founder pay'),
    ('other', 'Other'),
    ('launch', 'One-off launch costs'),
    ('costs', 'Total operating costs'),
    ('ebit', 'Operating profit'),
    ('turn', 'Turnover tax'),
    ('ptax', 'Profit tax (on distributed profit)'),
    ('profit', 'Net profit'),
    ('grant', 'Grant received (cash)'),
    ('cash', 'Cumulative cash (from starting cash)'),
    ('positive', 'Month number if profit ≥ 0 (else 999)'),
]


def pnl(sheet_name, col):
    s = wb.create_sheet(sheet_name)
    s['A1'] = f'Monthly P&L — {sheet_name.split(" ")[1]} scenario (all formulas; edit the Inputs sheet)'
    s['A1'].font = title
    R = {}
    for i, (key, label) in enumerate(ROWS):
        R[key] = i + 3
        s[f'A{i + 3}'] = label
        if key in ('month', '_costs', 'profit', 'cash', 'fee', 'costs'):
            s[f'A{i + 3}'].font = bold
    sc = lambda k: f"Inputs!${col}${SCEN_ROWS[k]}"
    for m in range(1, MONTHS + 1):
        c = get_column_letter(FIRST + m - 1)
        prev = get_column_letter(FIRST + m - 2)
        f = {}
        f['month'] = m
        f['q'] = f"=ROUND(MIN({sc('QCap')},{sc('Q1')}*(1+{sc('Growth')})^({c}{R['month']}-1)),0)"
        f['gmv'] = f"={c}{R['q']}*{sc('Price')}"
        f['refunds'] = f"={c}{R['gmv']}*RefundRate"
        f['netgmv'] = f"={c}{R['gmv']}-{c}{R['refunds']}"
        f['mentors'] = f"={c}{R['netgmv']}*(1-FeePct)"
        f['fee'] = f"={c}{R['netgmv']}*FeePct"
        f['vatbase'] = f"=IF(VATBase=2,{c}{R['netgmv']},{c}{R['fee']})"
        start = get_column_letter(max(FIRST, FIRST + m - 13))
        f['roll'] = 0 if m == 1 else f"=SUM({start}{R['vatbase']}:{prev}{R['vatbase']})"
        f['vatflag'] = f"=IF({c}{R['roll']}>VATThreshold,1,0)" if m == 1 else f"=IF(OR({prev}{R['vatflag']}=1,{c}{R['roll']}>VATThreshold),1,0)"
        f['vat'] = f"={c}{R['vatflag']}*{c}{R['vatbase']}*VATRate/(1+VATRate)"
        f['netrev'] = f"={c}{R['fee']}-{c}{R['vat']}"
        f['card'] = f"=({c}{R['gmv']}-CardFeeBack*{c}{R['refunds']})*CardFeePct"
        f['gross'] = f"={c}{R['netrev']}-{c}{R['card']}"
        f['_costs'] = None
        f['render'] = f"=(RenderWebUSD+RenderDbUSD+RenderStorageGB*RenderGBUSD+IF({c}{R['q']}>RenderUpgradeQ,RenderUpgradeUSD,0))*FX"
        f['email'] = f"=IF({c}{R['q']}*EmailsPerQ>ResendFreeEmails,ResendProUSD,0)*FX"
        f['didit'] = f"=MAX(0,{sc('Apps')}*ChecksPerApp-DiditFree)*DiditUSD*FX"
        f['ai'] = f"={sc('Apps')}*ReviewsPerApp*AIReviewUSD*FX"
        f['domain'] = "=DomainYear/12"
        f['acct'] = "=Accountant"
        f['bank'] = "=BankMonthly"
        f['mkt'] = f"={sc('Marketing')}"
        f['team'] = f"={sc('Team')}"
        f['other'] = "=OtherMonthly"
        f['launch'] = f"=IF({c}{R['month']}=1,LaunchOneOff,0)"
        f['costs'] = f"=SUM({c}{R['render']}:{c}{R['launch']})"
        f['ebit'] = f"={c}{R['gross']}-{c}{R['costs']}"
        f['turn'] = f"={c}{R['fee']}*TurnoverTax"
        f['ptax'] = f"=MAX(0,{c}{R['ebit']}-{c}{R['turn']})*DistributedShare*ProfitTaxRate"
        f['profit'] = f"={c}{R['ebit']}-{c}{R['turn']}-{c}{R['ptax']}"
        f['grant'] = f"=IF({c}{R['month']}=GrantMonth,GrantAmount,0)"
        f['cash'] = f"=StartingCash+{c}{R['profit']}+{c}{R['grant']}" if m == 1 else f"={prev}{R['cash']}+{c}{R['profit']}+{c}{R['grant']}"
        f['positive'] = f"=IF({c}{R['profit']}>=0,{c}{R['month']},999)"
        for key, val in f.items():
            if val is None:
                continue
            cell = s[f'{c}{R[key]}']
            cell.value = val
            if key not in ('month', 'q', 'vatflag', 'positive'):
                cell.number_format = '#,##0'
        s[f'{c}{R["month"]}'].font = white
        s[f'{c}{R["month"]}'].fill = head
    s[f'A{R["month"]}'].font = white
    s[f'A{R["month"]}'].fill = head
    s.column_dimensions['A'].width = 46
    s.column_dimensions['B'].width = 2
    for m in range(MONTHS):
        s.column_dimensions[get_column_letter(FIRST + m)].width = 9
    s.freeze_panes = 'C4'
    return s, R


sheets = {}
for label, col in (('Slow', 'B'), ('Base', 'C'), ('Good', 'D')):
    sheets[label] = pnl(f'P&L {label}', col)

# ---------------------------------------------------------------- Summary
S = wb.create_sheet('Summary', 0)
S['A1'] = 'Wisecall — 24-month financial model: summary (every number is a formula)'
S['A1'].font = title
S['A2'] = 'Edit the yellow cells on the Inputs sheet. PLACEHOLDER / [VERIFY] inputs are assumptions, not facts.'
hdr = ['Result', 'Slow', 'Base', 'Good', 'How it is calculated']
for c, h in zip('ABCDE', hdr):
    S[f'{c}4'] = h
    S[f'{c}4'].font = white
    S[f'{c}4'].fill = head
last = get_column_letter(FIRST + MONTHS - 1)
first = get_column_letter(FIRST)


def rng(label, key):
    s, R = sheets[label]
    return f"'{s.title}'!{first}{R[key]}:{last}{R[key]}"


def cell(label, key, m):
    s, R = sheets[label]
    return f"'{s.title}'!{get_column_letter(FIRST + m - 1)}{R[key]}"


LINES = [
    ('Break-even month (first month with net profit ≥ 0)', lambda L: f'=IF(MIN({rng(L, "positive")})>24,"not within 24 months",MIN({rng(L, "positive")}))', 'first month where net profit ≥ 0'),
    ('Cash needed until break-even (deepest cumulative loss)', lambda L: f'=MAX(0,-MIN({rng(L, "cash")}))', 'lowest point of cumulative cash, with starting cash and grant as set on Inputs'),
    ('Contribution per paid question (₾)', lambda L: f"=Inputs!{ {'Slow': 'B', 'Base': 'C', 'Good': 'D'}[L] }${SCEN_ROWS['Price']}*((1-RefundRate)*FeePct*(1-IF(VATBase=1,VATRate/(1+VATRate),0)) - IF(VATBase=2,(1-RefundRate)*VATRate/(1+VATRate),0) - (1-CardFeeBack*RefundRate)*CardFeePct)", 'price × (kept share × fee − VAT if registered − card fee); VAT included as if registered (worst case)'),
    ('Fixed monthly costs at month 12 (₾)', lambda L: f'={cell(L, "costs", 12)}-{cell(L, "launch", 12)}', 'total operating costs in month 12, without one-off costs'),
    ('Paid questions per month needed to cover month-12 costs', lambda L: '=ROUNDUP({c}8/{c}7,0)'.format(c={'Slow': 'B', 'Base': 'C', 'Good': 'D'}[L]), 'fixed costs ÷ contribution per question'),
    ('Paid questions in month 12', lambda L: f'={cell(L, "q", 12)}', ''),
    ('Paid questions in month 24', lambda L: f'={cell(L, "q", 24)}', ''),
    ('Platform revenue, months 1–24 (₾)', lambda L: f'=SUM({rng(L, "fee")})', ''),
    ('Total operating costs, months 1–24 (₾)', lambda L: f'=SUM({rng(L, "costs")})', ''),
    ('Net profit, months 1–24 (₾)', lambda L: f'=SUM({rng(L, "profit")})', ''),
    ('Cash at the end of month 24 (₾)', lambda L: f'={cell(L, "cash", 24)}', ''),
    ('Mentors’ share paid out, months 1–24 (₾)', lambda L: f'=SUM({rng(L, "mentors")})', 'money that passes through Wisecall to mentors'),
    ('Month VAT registration starts (if any)', lambda L: f'=IFERROR(MATCH(1,{rng(L, "vatflag")},0),"not within 24 months")', 'rolling 12-month VAT base passes the threshold'),
]
for i, (label, fn, how) in enumerate(LINES):
    row = 5 + i
    S[f'A{row}'] = label
    for c, L in zip('BCD', ('Slow', 'Base', 'Good')):
        S[f'{c}{row}'] = fn(L)
        S[f'{c}{row}'].fill = calc
        S[f'{c}{row}'].number_format = '#,##0' if 'Contribution' not in label else '#,##0.00'
    S[f'E{row}'] = how
S.column_dimensions['A'].width = 58
for c in 'BCD':
    S.column_dimensions[c].width = 20
S.column_dimensions['E'].width = 80

# Chart data block: base scenario revenue vs costs (links to the P&L)
S['A20'] = 'Chart data — Base scenario (links to P&L Base)'
S['A20'].font = bold
S['A21'], S['B21'], S['C21'], S['D21'] = 'Month', 'Net revenue after VAT − card fees', 'Operating costs', 'Cumulative cash'
for m in range(1, MONTHS + 1):
    row = 21 + m
    S[f'A{row}'] = m
    S[f'B{row}'] = f'={cell("Base", "gross", m)}'
    S[f'C{row}'] = f'={cell("Base", "costs", m)}'
    S[f'D{row}'] = f'={cell("Base", "cash", m)}'
    for c in 'BCD':
        S[f'{c}{row}'].number_format = '#,##0'
ch = LineChart()
ch.title = 'Base scenario: revenue vs costs (₾ per month)'
ch.y_axis.title = '₾'
ch.x_axis.title = 'Month'
ch.add_data(Reference(S, min_col=2, min_row=21, max_col=3, max_row=21 + MONTHS), titles_from_data=True)
ch.set_categories(Reference(S, min_col=1, min_row=22, max_row=21 + MONTHS))
ch.height, ch.width = 9, 20
S.add_chart(ch, 'F20')
ch2 = LineChart()
ch2.title = 'Base scenario: cumulative cash (₾)'
ch2.add_data(Reference(S, min_col=4, min_row=21, max_row=21 + MONTHS), titles_from_data=True)
ch2.set_categories(Reference(S, min_col=1, min_row=22, max_row=21 + MONTHS))
ch2.height, ch2.width = 9, 20
S.add_chart(ch2, 'F40')

# Scenario comparison of revenue
S['A48'] = 'Chart data — platform revenue per month, all scenarios'
S['A48'].font = bold
S['A49'], S['B49'], S['C49'], S['D49'] = 'Month', 'Slow', 'Base', 'Good'
for m in range(1, MONTHS + 1):
    row = 49 + m
    S[f'A{row}'] = m
    for c, L in zip('BCD', ('Slow', 'Base', 'Good')):
        S[f'{c}{row}'] = f'={cell(L, "fee", m)}'
        S[f'{c}{row}'].number_format = '#,##0'
ch3 = LineChart()
ch3.title = 'Platform revenue per month by scenario (₾)'
ch3.add_data(Reference(S, min_col=2, min_row=49, max_col=4, max_row=49 + MONTHS), titles_from_data=True)
ch3.set_categories(Reference(S, min_col=1, min_row=50, max_row=49 + MONTHS))
ch3.height, ch3.width = 9, 20
S.add_chart(ch3, 'F60')

# ---------------------------------------------------------------- Notes
N = wb.create_sheet('Notes')
notes = [
    'How to use: change the yellow cells on Inputs. Every other number is a formula.',
    'Revenue = platform fee on net bookings (bookings minus refunds). The mentors’ share passes through Wisecall and is not revenue.',
    'Cash timing: buyers pay up front; mentors are paid 7 days after the answer is readable (planned: once their balance reaches 100 ₾). '
    'Wisecall therefore holds mentors’ money for a while — this is a liability, never spendable cash. The model ignores the timing benefit on purpose.',
    'VAT: the switch VATBase decides whether VAT is charged on Wisecall’s fee only (agent model) or on the whole question price (merchant model). '
    'Ask an accountant before launch — with the merchant model VAT (18%) applies to all bookings once they pass 100,000 ₾ in 12 months.',
    'Taxes on mentors’ income are the mentors’ own responsibility (docs/legal/en/mentor-agreement.md §5), unless the accountant says Wisecall must withhold.',
    'Scenario numbers (questions, growth, prices, marketing) are PLACEHOLDERS, not forecasts. There is no traction data yet (pre-launch).',
    'Rebuild this file: python3 docs/business/tools/build_financial_model.py',
]
for i, t in enumerate(notes):
    N[f'A{i + 1}'] = t
N.column_dimensions['A'].width = 160

from openpyxl.workbook.properties import CalcProperties
wb.calculation = CalcProperties(fullCalcOnLoad=True)  # Excel / LibreOffice / Google Sheets compute every formula when the file opens
wb.save(OUT)
print('wrote', os.path.abspath(OUT))
