# Pilot plan: one school, one month in parallel (SCHOOL-150)

One real school runs a full month in SchoolSyncer **alongside** its old process (paper registers, fee books, Excel).
Nothing old is switched off. At the end of the month we compare the two side by side and decide whether the school
moves over for good.

This page covers how to pick the school, how to onboard it, what to compare each week, how we judge the month, and
how we back out if it goes wrong. The tools it refers to:

| Tool | Where | Who |
| --- | --- | --- |
| Setup checklist | Owner dashboard (card at the top, hides itself when done) | School owner |
| Report a problem | Bug button in the web top bar (also in the account menu and Ctrl+K); **Account** in the mobile app | Every signed-in user |
| Parallel-run check | **Reports > Parallel-run check** (`/reports/parallel-run`): print, or download each table for Excel | Owner, principal, admin, accountant (attendance: owner, principal, admin) |
| Problem reports inbox | Console > **Problem reports** | SchoolSyncer staff |
| Pilot health | Console > Schools > the school > **Pilot health** | SchoolSyncer staff |

## 1. Picking the pilot school

Pick one school that will actually finish the month. Size matters less than commitment.

Must have:

- **An owner or principal who will run it**, reachable on WhatsApp during school hours, who agrees to a 20-minute
  check-in every week.
- **A fee office that keeps a written register** (fee book, receipt book or Excel) it will keep filling in during the
  month. Without the old record there is nothing to compare against.
- **Daily attendance registers** kept by class teachers.
- **150 to 600 students, one or two campuses.** Big enough to find real problems, small enough to fix data by hand.
- At least one teacher and the accountant with Android phones and working mobile data; a computer in the office.
- Starts at the **beginning of a fee month** (vouchers for the month not yet printed), not during exams or the
  first week after a long holiday.

Avoid for the first pilot:

- Schools in the middle of a fee structure change, a merger or an ownership dispute.
- Schools that need features we do not have yet (e.g. a transport fee model we cannot express).
- Schools owned by friends or family of the team: they will not tell us when it is bad.

Write the choice down with the owner's name, the contact person in the fee office, and the start date.

## 2. Onboarding (the week before day 1)

Work through the owner's **setup checklist** together. Each item links to the screen that fixes it.

1. **School profile**: phone and city (printed on vouchers), logo. Settings > School profile.
2. **Academic year**: add the current year and mark it current. Classes and sections.
3. **Classes and sections** for this year.
4. **Students imported** from the school's Excel list (Students > Import). Check the count against the school's
   own number and spot-check ten students for class, guardian phone and CNIC.
5. **Fee heads and structures**: every head the school bills (tuition, computer, exam, transport...) and the
   amount per class. Fees > Fee setup. Copy concessions and sibling discounts from the fee book.
6. **Staff accounts**: the accountant and every class teacher get their own login (Staff directory). No shared
   logins: daily active users and the audit log depend on it.
7. **Messaging sender**: connect the school's WhatsApp sender or the SMS gateway (Settings > Messaging). Until then
   messages are only logged.
8. **Online payments** (optional): only if the school already has a JazzCash, Easypaisa or 1Bill merchant account.
9. **First attendance marked**: each class teacher marks one register on the phone with us watching.
10. **First vouchers generated**: generate the month's vouchers, compare five of them line by line with what the
    old fee book would have charged, then print.

Also before day 1:

- Show every user the **Report a problem** button and ask them to use it for anything odd, however small.
- Agree the weekly check-in slot.
- Note the **opening balances**: arrears per student from the old fee book. These are the hardest numbers to get
  right; import them as arrears or opening vouchers and have the accountant sign off the total.

## 3. During the month

The school does everything twice: the old way, and in SchoolSyncer. Every day:

- Teachers mark attendance on the phone **and** in the paper register.
- The fee office records every payment in SchoolSyncer **and** in the fee book, with the same receipt.

SchoolSyncer staff, every day (5 minutes):

- Console > Problem reports, filtered to the school: answer anything new the same day; move it to *In progress*
  as soon as someone is looking at it, so the reporter sees it was picked up.
- Pilot health: did attendance get taken in every section yesterday? Any failed messages? Did anybody sign in?

## 4. What to compare each week

Open **Reports > Parallel-run check** for the week's dates, print the three sheets and sit with the fee office and
one class teacher. Every printed table has a blank **Register** column for a tick.

| Sheet | Compare with | Must match |
| --- | --- | --- |
| Fees collected per day (by method) | The fee book or cash book total for each day | To the rupee, every day |
| Fees per payment method | Cash in hand, bank deposit slips, wallet statements | To the rupee |
| Fees per fee head | The fee book's head-wise totals, if the school keeps them | To the rupee (if the school allocates payments differently, write down the rule and check the overall total instead) |
| Vouchers issued vs paid (per class, per month) | Vouchers printed and the paid stamps in the fee book | Same count issued; same count paid in full |
| Attendance per section per day | Each class's paper register | Same number marked and present on every day; no blank cell on a school day |

Reversed payments (bounced cheques, mistakes) are not counted in SchoolSyncer's totals, so cross them out in the old
register too before comparing. Campus-limited staff only see their own campus: the owner should print the
whole-school sheets.

Every mismatch gets a line in the check-in notes with its cause. A mismatch is either a **data entry slip** (fix the
entry, note who and why), a **process difference** (agree which one is right) or a **bug** (file a problem report and
mark it data-loss if money or attendance went missing).

## 5. Success criteria for the month

The pilot succeeds when **all** of these hold for the month:

1. **Fee totals match the old register to the rupee**: every day's collection, every payment method, and the month's
   total. Any difference is explained and fixed by the end of the following week.
2. **Vouchers**: the count issued and the count paid match the fee book; no student was billed twice or missed.
3. **Attendance taken on every school day** in every section (Pilot health shows no missed school days at the end of
   the month, or each one has a reason such as a teacher on leave with the paper register only).
4. **No data-loss bugs open.** Nothing that lost or changed a payment, voucher, mark or attendance record is still
   open in the inbox. Other open reports have an agreed fix date.
5. **People used it themselves**: the accountant and at least 80% of class teachers active on at least 4 school days
   a week in the last two weeks (Pilot health, daily active users by role), without us doing the entry for them.
6. **Messages**: fee reminders and absence messages actually delivered (sent, not only logged), and failures below 5%.
7. **The owner says yes** to switching off the old fee book for the next month.

If 1 to 4 hold but 5 to 7 do not, extend the pilot by one month rather than calling it a success or a failure.

## 6. Exit and rollback plan

Because the old process keeps running the whole month, rollback is cheap: the school simply keeps its paper and
Excel records as the source of truth and stops using SchoolSyncer.

Stop the pilot early when any of these happen:

- A data-loss bug that we cannot fix within 2 school days.
- Fee totals that do not match for 2 weeks in a row with no explanation.
- The owner asks to stop.

How to roll back:

1. Tell the school in writing which records are authoritative (the old ones) from which date.
2. Export what they entered (fee collection, outstanding, attendance sheets from Reports, students from the
   directory) and hand the files over, so no work is lost.
3. Switch off parent messages (Settings > Messaging) so parents do not receive reminders from a system the school
   no longer uses.
4. Suspend the school from the console (not close it), with the reason. The data stays in case they come back.
5. Write a short post-mortem: what broke, what we would need to try again.

How to exit successfully:

1. Agree the switch-over date (start of the next fee month).
2. Freeze the old fee book on the last day of the pilot month and carry the closing balances into SchoolSyncer
   (they should already match).
3. Keep the paper attendance register for one more month as a backup, then stop.
4. Move the school from trial to a paid plan.

## 7. Weekly check-in template

Copy this for each week (20 minutes, owner or principal, the accountant, one class teacher, one of us).

```
Pilot check-in: <school>, week <n> (<from> to <to>)
Present:

Fees (Parallel-run check > Fees collected)
  SchoolSyncer total:          Rs
  Old fee book total:          Rs
  Difference:                  Rs        Explained? Y/N
  Days that did not match:
  Payment methods match? (cash / bank / wallet)

Vouchers (Parallel-run check > Vouchers)
  Issued: SS ___ / book ___     Paid in full: SS ___ / book ___
  Problems (wrong amount, duplicate, missing student):

Attendance (Parallel-run check > Attendance, Pilot health)
  School days this week: ___    Sections that missed a day:
  Sections where present counts differ from the paper register:

Usage (Pilot health)
  Active users per day (owner / admin / accountant / teachers):
  People not using it yet, and why:

Messages (Pilot health)
  Sent ___  Logged ___  Failed ___     Parents complaining of missing messages?

Problem reports (Console inbox)
  New this week ___   Fixed ___   Still open ___
  Data-loss bugs open (must be zero):

Decisions and actions (who, by when):

On track for the month's success criteria?  Yes / At risk / No
```
