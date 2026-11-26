import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { jsx, jsxs } from 'react/jsx-runtime'
import { STYLE } from '../shared/styles.js'
import { DaysInput } from '../components/fields.jsx'

/** 会话管理面板：自动归档开关 + 行尾天数输入，外壳由 ModuleCard 提供。 */
export function SessionPanel(props) {
  const { t, useSessionCard } = props
  const state = useSessionCard(snapshot => snapshot)
  const disabled = !state.writable
  return jsxs('div', {
    children: [
      state.failed ? jsx('p', { style: STYLE.hint, children: t('saveFailed') }, 'hint') : null,
      jsxs('div', {
        style: STYLE.row,
        children: [
          jsxs('div', {
            style: { minWidth: 0 },
            children: [
              jsx('div', { style: STYLE.label, children: t('autoArchive') }, 'label'),
              jsx('p', {
                style: STYLE.cardDesc,
                children: t(state.autoArchive ? 'sessionOn' : 'sessionOff'),
              }, 'hint'),
            ],
          }, 'text'),
          jsx(Switch, {
            checked: state.autoArchive,
            label: t('autoArchive'),
            disabled,
            onChange: props.toggleSessionAuto,
          }, 'switch'),
        ],
      }, 'toggle'),
      jsx(DaysInput, {
        label: t('idleDays'),
        suffix: t('idleDaysSuffix'),
        value: state.idleDays,
        max: 365,
        disabled,
        onCommit: props.setSessionIdleDays,
      }, 'idle'),
      jsx('div', { style: STYLE.divider }, 'divider-delete'),
      jsxs('div', {
        style: STYLE.row,
        children: [
          jsxs('div', {
            style: { minWidth: 0 },
            children: [
              jsx('div', { style: STYLE.label, children: t('autoDelete') }, 'label'),
              jsx('p', {
                style: STYLE.cardDesc,
                children: t(state.autoDelete ? 'deleteOn' : 'deleteOff'),
              }, 'hint'),
            ],
          }, 'text'),
          jsx(Switch, {
            checked: state.autoDelete,
            label: t('autoDelete'),
            disabled,
            onChange: props.toggleSessionDelete,
          }, 'switch'),
        ],
      }, 'toggle-delete'),
      jsx(DaysInput, {
        label: t('deleteDays'),
        suffix: t('deleteDaysSuffix'),
        value: state.deleteDays,
        max: 999,
        disabled,
        onCommit: props.setSessionDeleteDays,
      }, 'delete'),
    ],
  })
}