import { useState, useMemo, useEffect, useLayoutEffect, useRef, PointerEvent as ReactPointerEvent } from 'react';
import { Trash2, Plus, Check, Repeat, ChevronLeft, ChevronRight, X, Wallet2, ListChecks, Download, Calendar, Delete } from 'lucide-react';
import { Transaction } from '../types';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';
import { useVisualViewport, ACCESSORY_BAR_INSET } from '../hooks/useVisualViewportHeight';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type TabKey = 'checklist' | 'shopping' | 'category';
const TAB_ORDER: TabKey[] = ['checklist', 'shopping', 'category'];

const CATEGORY_COLORS = [
  { dot: 'bg-emerald-400', bar: 'bg-emerald-400', chip: 'bg-emerald-50 text-emerald-700' },
  { dot: 'bg-indigo-400', bar: 'bg-indigo-400', chip: 'bg-indigo-50 text-indigo-700' },
  { dot: 'bg-orange-400', bar: 'bg-orange-400', chip: 'bg-orange-50 text-orange-700' },
  { dot: 'bg-rose-400', bar: 'bg-rose-400', chip: 'bg-rose-50 text-rose-700' },
  { dot: 'bg-sky-400', bar: 'bg-sky-400', chip: 'bg-sky-50 text-sky-700' },
  { dot: 'bg-amber-400', bar: 'bg-amber-400', chip: 'bg-amber-50 text-amber-700' },
  { dot: 'bg-fuchsia-400', bar: 'bg-fuchsia-400', chip: 'bg-fuchsia-50 text-fuchsia-700' },
];

// Hex equivalents of CATEGORY_COLORS, same order, for drawing PDF colors that match the UI dots/bars.
const CATEGORY_HEX: [number, number, number][] = [
  [52, 211, 153],  // emerald-400
  [129, 140, 248], // indigo-400
  [251, 146, 60],  // orange-400
  [251, 113, 133], // rose-400
  [56, 189, 248],  // sky-400
  [251, 191, 36],  // amber-400
  [232, 121, 249], // fuchsia-400
];

const categoryHash = (category: string) => {
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  return hash;
};

const colorFor = (category: string) => CATEGORY_COLORS[categoryHash(category) % CATEGORY_COLORS.length];
const hexColorFor = (category: string) => CATEGORY_HEX[categoryHash(category) % CATEGORY_HEX.length];

type NewTransaction = Omit<Transaction, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'checked'>;

interface Props {
  transactions: Transaction[];
  onAdd: (data: NewTransaction) => void;
  onDelete: (id: string) => void;
  onToggleChecked: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Pick<Transaction, 'name' | 'category' | 'amount' | 'recurring'>>) => void;
  canEdit: boolean;
  hiddenCategories: string[];
  onHideCategory: (category: string) => void;
}

const itemKey = (name: string, category: string) => `${name.trim().toLowerCase()}|${category.trim().toLowerCase()}`;

const MONTH_PILL_W = 56;
const MONTH_GAP = 10;
const MONTH_VISIBLE = 5;
const MONTH_STRIP_W = MONTH_VISIBLE * MONTH_PILL_W + (MONTH_VISIBLE - 1) * MONTH_GAP;

const toDateStr = (year: number, month: number, day: number) =>
  `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

const shortDate = (dateStr: string) => {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const OPERATORS = '+−×÷';
const KEYPAD_KEYS = ['1', '2', '3', '÷', '4', '5', '6', '×', '7', '8', '9', '−', '.', '0', 'back', '+'];

// The amount field doubles as a small calculator, so "12+3.50" has to resolve to a number.
// Multiplication and division bind tighter than addition and subtraction, as on any keypad.
const evaluateAmount = (expr: string): number => {
  const tokens = expr.match(/\d+\.?\d*|[+−×÷]/g);
  if (!tokens) return 0;
  if (OPERATORS.includes(tokens[tokens.length - 1])) tokens.pop();
  if (!tokens.length) return 0;

  const terms: (number | string)[] = [Number(tokens[0]) || 0];
  for (let i = 1; i < tokens.length - 1; i += 2) {
    const value = Number(tokens[i + 1]) || 0;
    const last = terms[terms.length - 1] as number;
    if (tokens[i] === '×') terms[terms.length - 1] = last * value;
    else if (tokens[i] === '÷') terms[terms.length - 1] = value === 0 ? 0 : last / value;
    else terms.push(tokens[i], value);
  }

  let total = terms[0] as number;
  for (let i = 1; i < terms.length - 1; i += 2) {
    const value = terms[i + 1] as number;
    total = terms[i] === '+' ? total + value : total - value;
  }
  return Number.isFinite(total) ? total : 0;
};

export default function MonthlyChecklist({ transactions, onAdd, onDelete, onToggleChecked, onUpdate, canEdit, hiddenCategories, onHideCategory }: Props) {
  const now = new Date();
  const [activeMonth, setActiveMonth] = useState(now.getMonth());
  const [activeYear, setActiveYear] = useState(now.getFullYear());
  const [activeTab, setActiveTab] = useState<TabKey>('checklist');
  const [tabDirection, setTabDirection] = useState<'left' | 'right'>('right');

  // Animate the content wrapper's height across a tab switch instead of snapping instantly:
  // an abrupt height change (e.g. a long "By Category" list -> a short empty state) can otherwise
  // make mobile Safari's chrome (address bar) jump, which looks like a brief zoom/flick.
  const tabContentRef = useRef<HTMLDivElement>(null);
  const [tabContentHeight, setTabContentHeight] = useState<number | undefined>(undefined);
  const heightResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const changeTab = (next: TabKey) => {
    if (next === activeTab) return;
    if (tabContentRef.current) {
      setTabContentHeight(tabContentRef.current.scrollHeight);
    }
    setTabDirection(TAB_ORDER.indexOf(next) > TAB_ORDER.indexOf(activeTab) ? 'right' : 'left');
    setActiveTab(next);
  };

  useEffect(() => {
    if (tabContentRef.current) {
      setTabContentHeight(tabContentRef.current.scrollHeight);
    }
    if (heightResetTimer.current) clearTimeout(heightResetTimer.current);
    heightResetTimer.current = setTimeout(() => setTabContentHeight(undefined), 320);
    return () => {
      if (heightResetTimer.current) clearTimeout(heightResetTimer.current);
    };
  }, [activeTab]);

  // Sliding pill indicator behind the active tab label, morphing position/width to match it.
  const tabButtonRefs = useRef<Partial<Record<TabKey, HTMLButtonElement>>>({});
  const [tabIndicator, setTabIndicator] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const measure = () => {
      const el = tabButtonRefs.current[activeTab];
      if (el) setTabIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [activeTab]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [shopDate, setShopDate] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [sheetMode, setSheetMode] = useState<'category' | 'keypad'>('category');
  const [addKind, setAddKind] = useState<'bill' | 'shopping'>('bill');
  const [showCategoryInput, setShowCategoryInput] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [editingCategories, setEditingCategories] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const [dragX, setDragX] = useState(0);
  const dragStartX = useRef(0);
  const dragMoved = useRef(false);
  // Mirrors isDragging without the one-render lag a pointermove firing before React
  // commits setIsDragging(true) could otherwise hit, which dropped the drag's first pixels.
  const isDraggingRef = useRef(false);

  const handleCarouselPointerDown = (e: ReactPointerEvent) => {
    isDraggingRef.current = true;
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragMoved.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleCarouselPointerMove = (e: ReactPointerEvent) => {
    if (!isDraggingRef.current) return;
    const delta = e.clientX - dragStartX.current;
    if (Math.abs(delta) > 5) dragMoved.current = true;
    setDragX(delta);
  };

  const endCarouselDrag = () => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    // Move by however many pill-widths were actually dragged, not always a single month —
    // dragging several pills' worth used to still only advance one month and then snap back hard.
    const step = MONTH_PILL_W + MONTH_GAP;
    const monthDelta = Math.round(-dragX / step);
    if (monthDelta !== 0) {
      setActiveMonth(m => Math.min(11, Math.max(0, m + monthDelta)));
    }
    setDragX(0);
  };

  // Swipe left/right anywhere in the tabs section to switch between Checklist / Shopping / By Category,
  // without capturing the pointer so taps, checkboxes, inputs and vertical scrolling underneath still work normally.
  const tabTouchStart = useRef<{ x: number; y: number } | null>(null);
  const tabSwipeIntent = useRef<'horizontal' | 'vertical' | null>(null);

  const handleTabPointerDown = (e: ReactPointerEvent) => {
    tabTouchStart.current = { x: e.clientX, y: e.clientY };
    tabSwipeIntent.current = null;
  };

  const handleTabPointerMove = (e: ReactPointerEvent) => {
    if (!tabTouchStart.current) return;
    const dx = e.clientX - tabTouchStart.current.x;
    const dy = e.clientY - tabTouchStart.current.y;
    if (tabSwipeIntent.current === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      tabSwipeIntent.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
    }
  };

  const handleTabPointerEnd = (e: ReactPointerEvent) => {
    if (!tabTouchStart.current || tabSwipeIntent.current !== 'horizontal') {
      tabTouchStart.current = null;
      tabSwipeIntent.current = null;
      return;
    }
    const dx = e.clientX - tabTouchStart.current.x;
    const idx = TAB_ORDER.indexOf(activeTab);
    if (dx < -60 && idx < TAB_ORDER.length - 1) {
      changeTab(TAB_ORDER[idx + 1]);
    } else if (dx > 60 && idx > 0) {
      changeTab(TAB_ORDER[idx - 1]);
    }
    tabTouchStart.current = null;
    tabSwipeIntent.current = null;
  };

  const knownCategories = useMemo(() => {
    const all = Array.from(new Set(transactions.map(t => t.category).filter(Boolean)));
    return all.filter(c => !hiddenCategories.includes(c));
  }, [transactions, hiddenCategories]);

  // The most-used categories, offered as one-tap chips next to the description.
  const quickCategories = useMemo(() => {
    const counts = new Map<string, number>();
    transactions.forEach(t => {
      if (t.category) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    });
    return [...knownCategories]
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
      .slice(0, 4);
  }, [transactions, knownCategories]);

  const monthTransactions = useMemo(() => {
    return transactions
      .filter(t => {
        const d = new Date(t.date + 'T00:00:00');
        return d.getMonth() === activeMonth && d.getFullYear() === activeYear;
      })
      .sort((a, b) => Number(a.checked) - Number(b.checked));
  }, [transactions, activeMonth, activeYear]);

  const billTransactions = useMemo(() => monthTransactions.filter(t => t.kind !== 'shopping'), [monthTransactions]);
  const shoppingTransactions = useMemo(() => monthTransactions.filter(t => t.kind === 'shopping'), [monthTransactions]);

  const uncheckedItems = useMemo(() => billTransactions.filter(t => !t.checked), [billTransactions]);
  const checkedItems = useMemo(() => billTransactions.filter(t => t.checked), [billTransactions]);

  const billsPaidTotal = billTransactions
    .filter(t => t.checked)
    .reduce((sum, t) => sum + t.amount, 0);

  const shoppingTotal = shoppingTransactions.reduce((sum, t) => sum + t.amount, 0);

  const paidTotal = billsPaidTotal + shoppingTotal;

  const unpaidTotal = billTransactions
    .filter(t => !t.checked)
    .reduce((sum, t) => sum + t.amount, 0);

  const unpaidCount = billTransactions.filter(t => !t.checked).length;
  const recurringCount = billTransactions.filter(t => t.recurring).length;

  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    monthTransactions.filter(t => t.checked).forEach(t => {
      const cat = t.category.trim() || 'Uncategorized';
      map.set(cat, (map.get(cat) ?? 0) + t.amount);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [monthTransactions]);

  const itemsByCategory = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    monthTransactions.filter(t => t.checked).forEach(t => {
      const cat = t.category.trim() || 'Uncategorized';
      map.set(cat, [...(map.get(cat) ?? []), t]);
    });
    return map;
  }, [monthTransactions]);

  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedExportCategories, setSelectedExportCategories] = useState<string[]>([]);

  useLockBodyScroll(showAddModal || showExportModal);
  const { height: visualViewportHeight, top: visualViewportTop, keyboardOpen } = useVisualViewport();

  const openExportModal = () => {
    setSelectedExportCategories(categoryTotals.map(([cat]) => cat));
    setShowExportModal(true);
  };

  const toggleExportCategory = (cat: string) => {
    setSelectedExportCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  };

  const allCategoriesSelected = selectedExportCategories.length === categoryTotals.length;
  const toggleSelectAllExport = () => {
    setSelectedExportCategories(allCategoriesSelected ? [] : categoryTotals.map(([cat]) => cat));
  };

  const selectedExportTotal = categoryTotals
    .filter(([cat]) => selectedExportCategories.includes(cat))
    .reduce((sum, [, amt]) => sum + amt, 0);

  const handleExportPdf = async () => {
    const selected = categoryTotals.filter(([cat]) => selectedExportCategories.includes(cat));
    if (selected.length === 0) return;

    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 40;
    let y = 0;

    const ensureSpace = (needed: number) => {
      if (y + needed > pageH - 50) {
        doc.addPage();
        y = 50;
      }
    };

    // Header band
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageW, 86, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('TRAKMTRX', marginX, 38);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(226, 232, 240);
    doc.text('Spending Report', marginX, 58);
    doc.setFontSize(11);
    doc.text(`${MONTHS[activeMonth]} ${activeYear}`, pageW - marginX, 38, { align: 'right' });
    doc.setFontSize(9);
    doc.text(
      `Generated ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      pageW - marginX,
      58,
      { align: 'right' }
    );
    y = 86 + 36;

    // Total block
    doc.setTextColor(100, 116, 139);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(selected.length < categoryTotals.length ? 'TOTAL (SELECTED CATEGORIES)' : 'TOTAL', marginX, y);
    y += 28;
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(28);
    doc.text(fmt(selectedExportTotal), marginX, y);
    y += 24;
    doc.setDrawColor(241, 224, 208);
    doc.line(marginX, y, pageW - marginX, y);
    y += 30;

    selected.forEach(([cat, amt]) => {
      const [r, g, b] = hexColorFor(cat);
      const items = itemsByCategory.get(cat) ?? [];
      ensureSpace(26 + items.length * 15 + 20);

      doc.setFillColor(r, g, b);
      doc.circle(marginX + 4, y - 4, 4, 'F');
      doc.setTextColor(30, 41, 59);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(cat, marginX + 16, y);
      doc.text(fmt(amt), pageW - marginX, y, { align: 'right' });
      y += 10;

      const barW = pageW - marginX * 2;
      const pct = selectedExportTotal > 0 ? amt / selectedExportTotal : 0;
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(marginX, y, barW, 6, 3, 3, 'F');
      doc.setFillColor(r, g, b);
      doc.roundedRect(marginX, y, Math.max(barW * pct, 4), 6, 3, 3, 'F');
      y += 22;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(100, 116, 139);
      items.forEach(t => {
        ensureSpace(15);
        doc.text(t.name, marginX + 16, y);
        doc.text(fmt(t.amount), pageW - marginX, y, { align: 'right' });
        y += 15;
      });

      y += 20;
    });

    const suffix = selected.length < categoryTotals.length ? '-selected' : '';
    doc.save(`TRAKMTRX-${MONTHS[activeMonth]}-${activeYear}${suffix}.pdf`);
    setShowExportModal(false);
  };

  const fmt = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Auto-copy recurring items into the active month if they aren't there yet.
  const seededMonths = useRef(new Set<string>());
  useEffect(() => {
    if (!canEdit) return;
    const monthKey = `${activeYear}-${activeMonth}`;
    if (seededMonths.current.has(monthKey)) return;

    const byKey = new Map<string, Transaction[]>();
    transactions.filter(t => t.recurring).forEach(t => {
      const key = itemKey(t.name, t.category);
      byKey.set(key, [...(byKey.get(key) ?? []), t]);
    });

    const recurringTemplates = new Map<string, { tx: Transaction; earliestDate: string }>();
    byKey.forEach((txs, key) => {
      const latest = txs.reduce((a, b) => (b.date > a.date ? b : a));
      const earliestDate = txs.reduce((min, t) => (t.date < min ? t.date : min), txs[0].date);
      recurringTemplates.set(key, { tx: latest, earliestDate });
    });

    const presentKeys = new Set(monthTransactions.map(t => itemKey(t.name, t.category)));
    const activeMonthStart = toDateStr(activeYear, activeMonth, 1);

    recurringTemplates.forEach(({ tx, earliestDate }, key) => {
      if (presentKeys.has(key)) return;
      if (activeMonthStart < earliestDate) return;
      onAdd({
        amount: tx.amount,
        date: activeMonthStart,
        category: tx.category,
        name: tx.name,
        type: 'expense',
        kind: 'bill',
        recurring: true,
        note: ''
      });
    });

    seededMonths.current.add(monthKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMonth, activeYear, transactions]);

  const commitNewCategory = () => {
    const value = newCategory.trim();
    if (!value) return;
    setCategory(value);
    setNewCategory('');
    setShowCategoryInput(false);
  };

  const pressKey = (key: string) => {
    setAmount(prev => {
      if (key === 'back') return prev.slice(0, -1);
      if (OPERATORS.includes(key)) {
        if (!prev) return prev;
        return OPERATORS.includes(prev.slice(-1)) ? prev.slice(0, -1) + key : prev + key;
      }
      if (key === '.') {
        const lastNumber = prev.split(/[+−×÷]/).pop() ?? '';
        if (lastNumber.includes('.')) return prev;
        return lastNumber === '' ? prev + '0.' : prev + '.';
      }
      return prev + key;
    });
  };

  const handleAdd = () => {
    if (!name.trim()) return;
    const isShopping = addKind === 'shopping';
    const day = Math.min(now.getDate(), 28);
    const date = isShopping ? (shopDate || toDateStr(activeYear, activeMonth, day)) : toDateStr(activeYear, activeMonth, day);
    onAdd({
      amount: evaluateAmount(amount),
      date,
      category: category.trim() || 'Uncategorized',
      name: name.trim(),
      type: 'expense',
      kind: addKind,
      recurring: isShopping ? false : recurring,
      note: ''
    });
    setName('');
    setCategory('');
    setAmount('');
    setRecurring(false);
    setShopDate('');
    setSheetMode('category');
    setShowCategoryInput(false);
    setNewCategory('');
    setEditingCategories(false);
    setShowAddModal(false);
  };

  const goToPrevYear = () => setActiveYear(y => y - 1);
  const goToNextYear = () => setActiveYear(y => y + 1);

  return (
    <div className="space-y-5 pb-24">
      {/* Year switcher */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={goToPrevYear}
          aria-label="Previous year"
          className="rounded-full p-1.5 text-slate-400 hover:bg-white hover:text-slate-700"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-slate-700">{activeYear}</span>
        <button
          onClick={goToNextYear}
          aria-label="Next year"
          className="rounded-full p-1.5 text-slate-400 hover:bg-white hover:text-slate-700"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Month carousel */}
      <div
        className="overflow-hidden select-none"
        style={{ width: MONTH_STRIP_W, marginLeft: 'auto', marginRight: 'auto', marginBottom: 8, touchAction: 'pan-y', cursor: isDragging ? 'grabbing' : 'grab' }}
        onPointerDown={handleCarouselPointerDown}
        onPointerMove={handleCarouselPointerMove}
        onPointerUp={endCarouselDrag}
        onPointerCancel={endCarouselDrag}
        onPointerLeave={isDragging ? endCarouselDrag : undefined}
      >
        <div
          className="flex items-center ease-out"
          style={{
            gap: MONTH_GAP,
            transitionProperty: 'transform',
            transitionDuration: isDragging ? '0ms' : '300ms',
            transform: `translateX(${MONTH_STRIP_W / 2 - MONTH_PILL_W / 2 - activeMonth * (MONTH_PILL_W + MONTH_GAP) + dragX}px)`
          }}
        >
          {MONTHS.map((m, i) => {
            const distance = Math.abs(i - activeMonth);
            return (
              <button
                key={m}
                onClick={() => { if (!dragMoved.current) setActiveMonth(i); }}
                className={`shrink-0 whitespace-nowrap rounded-full py-1.5 text-sm font-medium transition-all duration-300 ${
                  i === activeMonth
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-white/70 text-slate-500 hover:bg-white'
                }`}
                style={{
                  width: MONTH_PILL_W,
                  opacity: i === activeMonth ? 1 : distance === 1 ? 0.75 : distance === 2 ? 0.45 : 0.2,
                  transform: `scale(${i === activeMonth ? 1 : 0.9})`
                }}
              >
                {m.slice(0, 3)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Summary card */}
      <div className="rounded-3xl border border-white/70 bg-white/60 p-5 shadow-[0_2px_16px_rgba(15,23,42,0.07)] backdrop-blur-xl">
        <div className="flex items-center gap-2 text-slate-700">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-900 text-white">
            <Wallet2 className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium">{MONTHS[activeMonth]} {activeYear}</span>
        </div>
        <p className="mt-4 text-4xl font-bold tracking-tight text-slate-900">{fmt(paidTotal)}</p>
        <p className="mt-1 text-xs font-medium text-slate-500">PAID SO FAR</p>
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <span>Bills <span className="font-semibold text-slate-700">{fmt(billsPaidTotal)}</span></span>
          <span className="text-zinc-300">•</span>
          <span>Spending <span className="font-semibold text-slate-700">{fmt(shoppingTotal)}</span></span>
        </div>

        <div className="mt-5 flex items-center gap-6 border-t border-zinc-100 pt-4">
          <div>
            <p className="text-xs text-slate-500">Unpaid</p>
            <p className="text-sm font-semibold text-slate-800">{fmt(unpaidTotal)}</p>
          </div>
          <div className="h-8 w-px bg-zinc-200" />
          <div>
            <p className="text-xs text-slate-500">To be paid</p>
            <p className="text-sm font-semibold text-slate-800">{billTransactions.length}</p>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-white/70 bg-white/60 p-4 shadow-[0_2px_16px_rgba(15,23,42,0.07)] backdrop-blur-xl">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-900">
            <ListChecks className="h-4 w-4 text-white" />
          </div>
          <p className="mt-3 text-xl font-bold text-slate-900">{unpaidCount}</p>
          <p className="text-xs text-slate-500">Unpaid item{unpaidCount !== 1 ? 's' : ''}</p>
        </div>
        <div className="rounded-2xl border border-white/70 bg-white/60 p-4 shadow-[0_2px_16px_rgba(15,23,42,0.07)] backdrop-blur-xl">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-900">
            <Repeat className="h-4 w-4 text-white" />
          </div>
          <p className="mt-3 text-xl font-bold text-slate-900">{recurringCount}</p>
          <p className="text-xs text-slate-500">Recurring</p>
        </div>
      </div>

      {/* View tabs + content: swipe horizontally anywhere here to switch tabs */}
      <div
        style={{ touchAction: 'pan-y' }}
        onPointerDown={handleTabPointerDown}
        onPointerMove={handleTabPointerMove}
        onPointerUp={handleTabPointerEnd}
        onPointerCancel={() => { tabTouchStart.current = null; tabSwipeIntent.current = null; }}
        className="space-y-5"
      >
      {/* View tabs */}
      <div className="relative flex gap-1 rounded-full bg-white/70 p-1 text-sm font-medium">
        <div
          aria-hidden
          className="absolute inset-y-1 rounded-full bg-slate-900 shadow-sm transition-[transform,width] duration-300 ease-out"
          style={{ width: tabIndicator.width, transform: `translateX(${tabIndicator.left}px)` }}
        />
        <button
          ref={(el) => { tabButtonRefs.current.checklist = el ?? undefined; }}
          onClick={() => changeTab('checklist')}
          className={`relative z-10 flex-1 whitespace-nowrap rounded-full py-1.5 transition-colors duration-300 ${
            activeTab === 'checklist' ? 'text-white' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Checklist
        </button>
        <button
          ref={(el) => { tabButtonRefs.current.shopping = el ?? undefined; }}
          onClick={() => changeTab('shopping')}
          className={`relative z-10 flex-1 whitespace-nowrap rounded-full py-1.5 transition-colors duration-300 ${
            activeTab === 'shopping' ? 'text-white' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Spending
        </button>
        <button
          ref={(el) => { tabButtonRefs.current.category = el ?? undefined; }}
          onClick={() => changeTab('category')}
          className={`relative z-10 flex-1 whitespace-nowrap rounded-full py-1.5 transition-colors duration-300 ${
            activeTab === 'category' ? 'text-white' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          By Category
        </button>
      </div>

      <div
        className="overflow-hidden transition-[height] duration-300 ease-out"
        style={{ height: tabContentHeight }}
      >
      <div key={activeTab} ref={tabContentRef} className={tabDirection === 'right' ? 'animate-tab-slide-right' : 'animate-tab-slide-left'}>

      {activeTab === 'category' ? (
        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <h4 className="mb-4 text-sm font-semibold text-slate-800">Spending by category</h4>
          {categoryTotals.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-400">
              No paid items yet this month. Check items off to see the breakdown.
            </div>
          ) : (
            <div className="space-y-4">
              {categoryTotals.map(([cat, amt]) => {
                const pct = paidTotal > 0 ? (amt / paidTotal) * 100 : 0;
                const c = colorFor(cat);
                const isOpen = expandedCategory === cat;
                const items = itemsByCategory.get(cat) ?? [];
                return (
                  <div key={cat}>
                    <button
                      type="button"
                      onClick={() => setExpandedCategory(isOpen ? null : cat)}
                      className="mb-1.5 flex w-full items-center justify-between gap-2 text-left text-sm"
                    >
                      <span className="flex items-center gap-2 font-medium text-slate-700">
                        <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                        {cat}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-800">{fmt(amt)}</span>
                        <ChevronRight className={`h-3.5 w-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      </span>
                    </button>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${pct}%` }} />
                    </div>
                    {isOpen && (
                      <div className="mt-2.5 space-y-1.5 border-l-2 border-slate-100 pl-3">
                        {items.map(t => (
                          <div key={t.id} className="flex items-center justify-between text-xs text-slate-500">
                            <span className="truncate pr-2">{t.name}</span>
                            <span className="shrink-0 font-medium text-slate-600">{fmt(t.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : activeTab === 'shopping' ? (
        <div className="space-y-2.5">
          {shoppingTransactions.length === 0 ? (
            <div className="rounded-3xl bg-white px-4 py-12 text-center text-sm text-slate-400 shadow-sm">
              No shopping expenses logged yet this month. Tap + to add one.
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 overflow-hidden rounded-3xl border border-zinc-100 bg-white shadow-sm">
              {shoppingTransactions.map(t => {
                const c = colorFor(t.category);
                return (
                  <div key={t.id} className="flex items-center gap-2.5 px-4 py-3">
                    <span className="w-11 shrink-0 text-[11px] font-medium text-slate-400">{shortDate(t.date)}</span>

                    <div className="min-w-0 flex-1">
                      {canEdit ? (
                        <input
                          defaultValue={t.name}
                          onBlur={(e) => onUpdate(t.id, { name: e.target.value })}
                          className="w-full border-none bg-transparent p-0 text-base font-medium text-slate-800 outline-none sm:text-sm"
                        />
                      ) : (
                        <p className="truncate text-sm font-medium text-slate-800">{t.name}</p>
                      )}
                    </div>

                    <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline-flex ${c.chip}`}>
                      {t.category}
                    </span>

                    {canEdit ? (
                      <input
                        type="number"
                        step="0.01"
                        defaultValue={t.amount}
                        onBlur={(e) => onUpdate(t.id, { amount: parseFloat(e.target.value) || 0 })}
                        className="w-16 shrink-0 border-none bg-transparent text-right text-base font-semibold text-slate-800 outline-none sm:text-sm"
                      />
                    ) : (
                      <span className="shrink-0 text-sm font-semibold text-slate-800">{t.amount}</span>
                    )}

                    {canEdit && (
                      <button
                        onClick={() => onDelete(t.id)}
                        aria-label="Delete item"
                        className="shrink-0 rounded-full p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {billTransactions.length === 0 ? (
            <div className="rounded-3xl bg-white px-4 py-12 text-center text-sm text-slate-400 shadow-sm">
              No items yet. Tap + to add one.
            </div>
          ) : (
            <>
              {uncheckedItems.map(t => {
                const c = colorFor(t.category);
                return (
                  <div key={t.id} className="flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-sm">
                    <button
                      onClick={() => canEdit && onToggleChecked(t.id)}
                      disabled={!canEdit}
                      aria-label="Mark as paid"
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-slate-200 bg-white ${!canEdit ? 'cursor-default' : ''}`}
                    />

                    <div className="min-w-0 flex-1">
                      {canEdit ? (
                        <input
                          defaultValue={t.name}
                          onBlur={(e) => onUpdate(t.id, { name: e.target.value })}
                          className="w-full border-none bg-transparent p-0 text-base font-medium text-slate-800 outline-none sm:text-sm"
                        />
                      ) : (
                        <p className="truncate text-sm font-medium text-slate-800">{t.name}</p>
                      )}
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${c.chip}`}>
                          {t.category}
                        </span>
                        {t.recurring && <Repeat className="h-3 w-3 text-slate-400" />}
                      </div>
                    </div>

                    {canEdit ? (
                      <input
                        type="number"
                        step="0.01"
                        defaultValue={t.amount}
                        onBlur={(e) => onUpdate(t.id, { amount: parseFloat(e.target.value) || 0 })}
                        className="w-16 shrink-0 border-none bg-transparent text-right text-base font-semibold text-slate-800 outline-none sm:text-sm"
                      />
                    ) : (
                      <span className="shrink-0 text-sm font-semibold text-slate-800">{t.amount}</span>
                    )}

                    {canEdit && (
                      <>
                        <button
                          onClick={() => onUpdate(t.id, { recurring: !t.recurring })}
                          aria-label={t.recurring ? 'Stop repeating monthly' : 'Repeat every month'}
                          title={t.recurring ? 'Repeats every month' : 'Repeat every month'}
                          className={`shrink-0 rounded-full p-1.5 ${t.recurring ? 'text-indigo-500' : 'text-slate-300 hover:text-slate-500'}`}
                        >
                          <Repeat className="h-3.5 w-3.5" />
                        </button>

                        <button
                          onClick={() => onDelete(t.id)}
                          aria-label="Delete item"
                          className="shrink-0 rounded-full p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}

              {checkedItems.length > 0 && (
                <div className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-100 bg-zinc-50">
                  {checkedItems.map(t => {
                    const c = colorFor(t.category);
                    return (
                      <div key={t.id} className="flex items-center gap-2.5 px-3 py-2 opacity-60">
                        <button
                          onClick={() => canEdit && onToggleChecked(t.id)}
                          disabled={!canEdit}
                          aria-label="Mark as unpaid"
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-900 ${!canEdit ? 'cursor-default' : ''}`}
                        >
                          <Check className="h-2.5 w-2.5 text-white" />
                        </button>

                        <div className="min-w-0 flex-1">
                          {canEdit ? (
                            <input
                              defaultValue={t.name}
                              onBlur={(e) => onUpdate(t.id, { name: e.target.value })}
                              className="w-full border-none bg-transparent p-0 text-base font-medium text-slate-400 line-through outline-none sm:text-[13px]"
                            />
                          ) : (
                            <p className="truncate text-[13px] font-medium text-slate-400 line-through">{t.name}</p>
                          )}
                        </div>

                        <span className={`hidden shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium sm:inline-flex ${c.chip}`}>
                          {t.category}
                        </span>

                        <span className="w-14 shrink-0 text-right text-[13px] font-semibold text-slate-500">{t.amount}</span>

                        {canEdit && (
                          <button
                            onClick={() => onDelete(t.id)}
                            aria-label="Delete item"
                            className="shrink-0 rounded-full p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
      </div>
      </div>
      </div>

      {/* Floating add button */}
      {canEdit && activeTab !== 'category' && (
        <button
          onClick={() => {
            const isShopping = activeTab === 'shopping';
            setAddKind(isShopping ? 'shopping' : 'bill');
            setShopDate(isShopping ? toDateStr(activeYear, activeMonth, Math.min(now.getDate(), 28)) : '');
            setSheetMode('category');
            setShowCategoryInput(false);
            setNewCategory('');
            setEditingCategories(false);
            setShowAddModal(true);
          }}
          aria-label={activeTab === 'shopping' ? 'Add shopping expense' : 'Add expense'}
          className="fixed bottom-6 left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg shadow-slate-900/20 hover:bg-slate-800"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}

      {/* Floating export button */}
      {activeTab === 'category' && categoryTotals.length > 0 && (
        <button
          onClick={openExportModal}
          aria-label="Export spending report"
          className="fixed bottom-6 left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg shadow-slate-900/20 hover:bg-slate-800"
        >
          <Download className="h-6 w-6" />
        </button>
      )}

      {/* Add item bottom sheet */}
      {canEdit && showAddModal && (
        <>
          {/* Dim backdrop: always the full layout viewport, independent of the keyboard-aware
              positioning below, so a transient mismatch between visualViewport height/top while
              the keyboard animates can never leave a gap of undimmed page showing through — any
              such gap shows this translucent dim, never raw page content. */}
          <div className="fixed inset-0 z-20 bg-slate-900/30" onClick={() => setShowAddModal(false)} />
          {/* The sheet stays sized to its own content, positioned within the keyboard-aware visual
              viewport, so any empty space above a short sheet shows the dim backdrop above — not a
              solid white box stretched to fill the screen. ACCESSORY_BAR_INSET reserves space at
              the bottom so content doesn't sit behind iOS's translucent keyboard accessory bar,
              which is drawn over the visual viewport instead of shrinking it. */}
          <div
            className="pointer-events-none fixed inset-x-0 z-20 flex items-end justify-center motion-safe:transition-[top,height] motion-safe:duration-200 motion-safe:ease-out sm:items-center"
            style={{ top: visualViewportTop, height: visualViewportHeight ?? '100dvh' }}
          >
            <div
              className="pointer-events-auto flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:rounded-3xl"
              style={{ paddingBottom: keyboardOpen ? ACCESSORY_BAR_INSET : undefined }}
            >
             <div className="min-h-0 overflow-y-auto overscroll-contain pb-5">
              <div className="flex justify-center pt-2.5">
                <div className="h-1 w-9 rounded-full bg-slate-200" />
              </div>

              <div className="relative px-5 pt-3">
                <button
                  onClick={() => setShowAddModal(false)}
                  aria-label="Close"
                  className="absolute left-5 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-14 w-14 items-center justify-center rounded-full text-lg font-semibold ${
                      category ? colorFor(category).chip : 'bg-slate-100 text-slate-300'
                    }`}
                  >
                    {category ? category.trim().charAt(0).toUpperCase() : <Wallet2 className="h-6 w-6" />}
                  </div>
                  <p className="mt-1.5 max-w-[12rem] truncate text-xs text-slate-400">{category || 'Select category'}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSheetMode(m => (m === 'keypad' ? 'category' : 'keypad'))}
                className="flex w-full flex-col items-center py-3"
              >
                <span className="text-4xl font-bold tracking-tight text-slate-900">{amount || '0'}</span>
                {[...amount].some(ch => OPERATORS.includes(ch)) && (
                  <span className="mt-1 text-xs font-medium text-slate-400">= {evaluateAmount(amount).toFixed(2)}</span>
                )}
              </button>

              <div className="mx-5 rounded-2xl bg-slate-50 p-3.5">
                <input
                  placeholder="Describe your transaction"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400 sm:text-sm"
                />
                {quickCategories.length > 0 && (
                  <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-0.5">
                    {quickCategories.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCategory(category === c ? '' : c)}
                        className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium ${
                          category === c ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'
                        }`}
                      >
                        {category === c ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />} {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center gap-2 px-5">
                {addKind === 'shopping' ? (
                  <div className="relative flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700">
                    <Calendar className="h-3.5 w-3.5" />
                    {shopDate ? shortDate(shopDate) : 'Today'}
                    <input
                      type="date"
                      aria-label="Date"
                      value={shopDate}
                      onChange={(e) => setShopDate(e.target.value)}
                      min={toDateStr(activeYear, activeMonth, 1)}
                      max={toDateStr(activeYear, activeMonth, daysInMonth(activeYear, activeMonth))}
                      className="absolute inset-0 h-full w-full opacity-0"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRecurring(r => !r)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
                      recurring ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    <Repeat className="h-3.5 w-3.5" /> {recurring ? 'Repeats monthly' : "Don't repeat"}
                  </button>
                )}
                {sheetMode === 'keypad' && (
                  <button
                    type="button"
                    onClick={() => setSheetMode('category')}
                    className="ml-auto flex items-center gap-1.5 rounded-full bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white"
                  >
                    <Check className="h-3.5 w-3.5" /> Done
                  </button>
                )}
              </div>

              {sheetMode === 'keypad' ? (
                <div className="mt-3 grid grid-cols-4 gap-2 px-5">
                  {KEYPAD_KEYS.map(key => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => pressKey(key)}
                      aria-label={key === 'back' ? 'Delete' : key}
                      className={`flex h-12 items-center justify-center rounded-2xl text-lg font-medium active:bg-slate-200 ${
                        OPERATORS.includes(key) || key === 'back' ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-900'
                      }`}
                    >
                      {key === 'back' ? <Delete className="h-5 w-5" /> : key}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-4 px-5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-900">Select category</p>
                    {knownCategories.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setEditingCategories(v => !v)}
                        className="text-xs font-medium text-slate-500 hover:text-slate-700"
                      >
                        {editingCategories ? 'Done' : 'Edit'}
                      </button>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-x-2 gap-y-3">
                    {knownCategories.map(c => (
                      <div key={c} className="relative">
                        <button
                          type="button"
                          onClick={() => setCategory(category === c ? '' : c)}
                          className="flex w-full flex-col items-center gap-1.5"
                        >
                          <span
                            className={`flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold ${colorFor(c).chip} ${
                              category === c ? 'ring-2 ring-slate-900 ring-offset-2' : ''
                            }`}
                          >
                            {c.charAt(0).toUpperCase()}
                          </span>
                          <span className="w-full truncate text-center text-[11px] text-slate-500">{c}</span>
                        </button>
                        {editingCategories && (
                          <button
                            type="button"
                            onClick={() => {
                              onHideCategory(c);
                              if (category === c) setCategory('');
                            }}
                            aria-label={`Remove ${c}`}
                            className="absolute -top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setShowCategoryInput(v => !v)}
                      className="flex w-full flex-col items-center gap-1.5"
                    >
                      <span
                        className={`flex h-12 w-12 items-center justify-center rounded-full border border-dashed text-slate-400 ${
                          showCategoryInput ? 'border-slate-400 bg-slate-50' : 'border-slate-300'
                        }`}
                      >
                        <Plus className="h-5 w-5" />
                      </span>
                      <span className="w-full truncate text-center text-[11px] text-slate-500">New</span>
                    </button>
                  </div>
                  {showCategoryInput && (
                    <div className="mt-3 flex gap-2">
                      <input
                        autoFocus
                        placeholder="Name your category"
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitNewCategory();
                          }
                        }}
                        className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-slate-400 sm:text-sm"
                      />
                      <button
                        type="button"
                        onClick={commitNewCategory}
                        disabled={!newCategory.trim()}
                        className="shrink-0 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-40"
                      >
                        Add
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-5 px-5">
                <div className="flex gap-1 rounded-full bg-slate-100 p-1 text-sm font-medium">
                  {(['bill', 'shopping'] as const).map(k => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setAddKind(k)}
                      className={`flex-1 rounded-full py-1.5 transition-colors ${
                        addKind === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                      }`}
                    >
                      {k === 'bill' ? 'Bill' : 'Spending'}
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleAdd}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-3 text-sm font-medium text-white hover:bg-slate-800"
                >
                  <Plus className="h-3.5 w-3.5" /> {addKind === 'shopping' ? 'Log expense' : 'Add to list'}
                </button>
              </div>
             </div>
            </div>
          </div>
        </>
      )}

      {/* Export report bottom sheet */}
      {showExportModal && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/30 sm:items-center" onClick={() => setShowExportModal(false)}>
          <div
            className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-base font-semibold text-slate-900">Export report</h4>
              <button onClick={() => setShowExportModal(false)} aria-label="Close" className="rounded-full p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="text-slate-500">{MONTHS[activeMonth]} {activeYear}</span>
              <button type="button" onClick={toggleSelectAllExport} className="font-medium text-slate-700 hover:underline">
                {allCategoriesSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            <div className="max-h-64 space-y-1 overflow-y-auto rounded-2xl border border-slate-100 p-1.5">
              {categoryTotals.map(([cat, amt]) => {
                const c = colorFor(cat);
                const checked = selectedExportCategories.includes(cat);
                return (
                  <label key={cat} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleExportCategory(cat)}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                    />
                    <span className={`h-2 w-2 shrink-0 rounded-full ${c.dot}`} />
                    <span className="flex-1 truncate text-sm text-slate-700">{cat}</span>
                    <span className="text-sm font-medium text-slate-500">{fmt(amt)}</span>
                  </label>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-slate-500">{selectedExportCategories.length} selected</span>
              <span className="font-semibold text-slate-800">{fmt(selectedExportTotal)}</span>
            </div>

            <button
              onClick={handleExportPdf}
              disabled={selectedExportCategories.length === 0}
              className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> Export PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
