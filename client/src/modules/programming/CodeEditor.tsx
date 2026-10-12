/**
 * CodeMirror 6 editor for the debugging workspace: line numbers, JavaScript
 * highlighting, a dark "instrument panel" theme and a flag gutter (click the
 * gutter or a line number to mark a suspect line).
 */

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { EditorState, RangeSet, RangeSetBuilder, StateEffect, StateField, Compartment } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  GutterMarker,
  drawSelection,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type BlockInfo,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export interface CodeEditorHandle {
  getCode(): string;
  /** Replaces the whole document (e.g. after a reset). */
  setCode(code: string): void;
  focus(): void;
  /** 1-based line of the main cursor. */
  cursorLine(): number;
}

interface Props {
  initialCode: string;
  flags: number[];
  readOnly?: boolean;
  onChange: (code: string) => void;
  onToggleFlag: (line: number, flagged: boolean) => void;
  onRun?: () => void;
  handleRef?: Ref<CodeEditorHandle>;
  ariaLabel?: string;
}

class FlagMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-flag-marker';
    el.setAttribute('aria-label', 'Flagged as suspect');
    return el;
  }
}
const flagMarker = new FlagMarker();

class FlagSpacer extends GutterMarker {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-flag-spacer';
    return el;
  }
}

const setFlags = StateEffect.define<number[]>();
const toggleFlag = StateEffect.define<{ from: number; to: number; on: boolean }>();

const flagField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    let next = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setFlags)) {
        const doc = tr.state.doc;
        const lines = [...new Set(e.value)].filter((l) => l >= 1 && l <= doc.lines).sort((a, b) => a - b);
        next = RangeSet.of(lines.map((l) => flagMarker.range(doc.line(l).from)));
      } else if (e.is(toggleFlag)) {
        const { from, to, on } = e.value;
        next = next.update({ filter: (pos) => pos < from || pos > to });
        if (on) next = next.update({ add: [flagMarker.range(from)] });
      }
    }
    return next;
  },
});

/** 1-based line numbers of the current flags. */
function flaggedLines(state: EditorState): number[] {
  const out = new Set<number>();
  state.field(flagField).between(0, state.doc.length, (from) => {
    out.add(state.doc.lineAt(from).number);
  });
  return [...out].sort((a, b) => a - b);
}

const flagLineHighlight = EditorView.decorations.compute([flagField], (state) => {
  const builder = new RangeSetBuilder<Decoration>();
  for (const n of flaggedLines(state)) {
    const from = state.doc.line(n).from;
    builder.add(from, from, Decoration.line({ class: 'cm-flagged-line' }));
  }
  return builder.finish();
});

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: '#c4a7ff' },
  { tag: [t.string, t.special(t.string)], color: '#9ee6a3' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#ffb86b' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#6c7a99', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#7cc7ff' },
  { tag: [t.definition(t.variableName)], color: '#e7ecf7' },
  { tag: [t.propertyName], color: '#a9d1ff' },
  { tag: [t.operator, t.compareOperator, t.logicOperator, t.arithmeticOperator], color: '#ff9ac1' },
  { tag: [t.bracket, t.paren, t.squareBracket, t.brace], color: '#aab6d3' },
]);

const theme = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--panel)', color: 'var(--panel-text)', height: '100%', fontSize: '13.5px' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.65' },
    '.cm-content': { caretColor: '#fff', padding: '10px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#fff' },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#2d3d66 !important' },
    '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--panel-muted)', border: 'none', borderRight: '1px solid var(--panel-border)' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 4px', minWidth: '34px', cursor: 'pointer' },
    '.cm-activeLine': { backgroundColor: 'rgba(124, 92, 255, 0.07)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(124, 92, 255, 0.12)', color: 'var(--panel-text)' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(124, 92, 255, 0.35)', outline: 'none' },
  },
  { dark: true },
);

export function CodeEditor(props: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editable = useRef(new Compartment());
  const cb = useRef(props);
  cb.current = props;

  useEffect(() => {
    if (!host.current) return;
    const toggleAt = (view: EditorView, line: BlockInfo) => {
      const docLine = view.state.doc.lineAt(line.from);
      const on = !flaggedLines(view.state).includes(docLine.number);
      view.dispatch({ effects: toggleFlag.of({ from: docLine.from, to: docLine.to, on }) });
      cb.current.onToggleFlag(docLine.number, on);
      return true;
    };
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: props.initialCode,
        extensions: [
          flagField,
          gutter({
            class: 'cm-flag-gutter',
            markers: (v) => v.state.field(flagField),
            initialSpacer: () => new FlagSpacer(),
            domEventHandlers: { mousedown: toggleAt },
          }),
          lineNumbers({ domEventHandlers: { mousedown: toggleAt } }),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          flagLineHighlight,
          javascript(),
          syntaxHighlighting(highlight),
          theme,
          EditorState.tabSize.of(2),
          editable.current.of(EditorView.editable.of(!props.readOnly)),
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                cb.current.onRun?.();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange(u.state.doc.toString());
          }),
          EditorView.contentAttributes.of({ 'aria-label': props.ariaLabel ?? 'Code editor' }),
        ],
      }),
    });
    view.dispatch({ effects: setFlags.of(props.flags) });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once; later prop changes are pushed in by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Server-confirmed flags (after edits the server remaps them like the editor does).
  const flagKey = props.flags.join(',');
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (flaggedLines(view.state).join(',') !== flagKey) view.dispatch({ effects: setFlags.of(props.flags) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flagKey]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: editable.current.reconfigure(EditorView.editable.of(!props.readOnly)) });
  }, [props.readOnly]);

  useImperativeHandle(
    props.handleRef,
    () => ({
      getCode: () => viewRef.current?.state.doc.toString() ?? '',
      setCode: (code: string) => {
        const view = viewRef.current;
        if (!view || view.state.doc.toString() === code) return;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
      },
      focus: () => viewRef.current?.focus(),
      cursorLine: () => {
        const view = viewRef.current;
        return view ? view.state.doc.lineAt(view.state.selection.main.head).number : 1;
      },
    }),
    [],
  );

  return <div className="prog-editor-host" ref={host} />;
}
