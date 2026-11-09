import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { FilterDropdown } from '../../src/components/FilterDropdown';
import { SlideToConfirm } from '../../src/components/SlideToConfirm';
import { AREA_SELECT, areaAllowsVehicle, sortAreas, type Area } from '../../src/lib/areas';
import { reservationErrorMessage } from '../../src/lib/reservations';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { theme } from '../../src/lib/theme';
import { useBottomInset } from '../../src/hooks/useBottomInset';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  balanceToSettle,
  isNegativeBalance,
  canApplyPayment,
  canEditSession,
  canEditSessionDetails,
  paymentsDisplay,
  refundAmountError,
  startsIn,
  sessionReturnRoute,
  walkInErrorMessage,
  type PaymentMethod,
  priceBreakdownLines,
  setRateLabel,
} from '../../src/lib/walkIn';
import { VEHICLE_TYPE_LABELS, type VehicleType } from '../../src/lib/searchFilters';
import { formatLocalDateTime, formatPeso } from '../../src/utils/formatters';

// One session (opened from Active Sessions or the Availability Sessions tab): see the amount
// due and balance; Edit details and Apply payment open their own screens (rj t131u) and this
// page reloads when you come back; apply fees; end it once the balance is settled
// (server-enforced).
export default function SessionScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const params = useLocalSearchParams<{
    id?: string | string[];
    from?: string | string[];
    notice?: string | string[];
  }>();
  const id = firstParam(params.id);
  // Opened from the Availability Sessions tab: end / cancel return there instead.
  const from = firstParam(params.from);
  const [d, setD] = React.useState<any>(null);
  const [error, setError] = React.useState<string | null>(null);
  // 'Session saved' / 'Payment … recorded' handed back by the Edit / Pay screens.
  const returnedNotice = firstParam(params.notice) || null;
  const [localNotice, setLocalNotice] = React.useState<string | null>(null);
  const notice = localNotice ?? returnedNotice;
  const router = useRouter();
  const setNotice = (text: string | null) => {
    setLocalNotice(text);
    if (returnedNotice) router.setParams({ notice: undefined });
  };
  const [showPayments, setShowPayments] = React.useState(false);
  const [confirmFee, setConfirmFee] = React.useState<string | null>(null);
  const [feeError, setFeeError] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState(false);
  const [payAmount, setPayAmount] = React.useState('');
  const [cancelReason, setCancelReason] = React.useState('');
  const [cancelAttempt, setCancelAttempt] = React.useState(0);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelError, setCancelError] = React.useState<string | null>(null);
  const [areas, setAreas] = React.useState<Area[]>([]);
  const [areaError, setAreaError] = React.useState<string | null>(null);
  const [approving, setApproving] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [rejectAttempt, setRejectAttempt] = React.useState(0);
  const [payMethod, setPayMethod] = React.useState<PaymentMethod>('cash');
  const [payNote, setPayNote] = React.useState('');
  const [payError, setPayError] = React.useState<string | null>(null);
  const [paying, setPaying] = React.useState(false);
  const [endError, setEndError] = React.useState<{ text: string; balance: number } | null>(null);
  const [waiveNote, setWaiveNote] = React.useState('');
  const [ending, setEnding] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!id) return;
    const { data, error: e } = await supabase.rpc('session_details', { p_session_id: id });
    if (e || data?.error) {
      setError(e?.message || walkInErrorMessage(data?.error));
      return;
    }
    setError(null);
    setD(data);
    const { data: areaRows } = await supabase
      .from('areas')
      .select(AREA_SELECT)
      .eq('location_id', data.session.location_id);
    setAreas(sortAreas((areaRows || []) as unknown as Area[]));
  }, [id]);

  useFocusEffect(
    React.useCallback(() => {
      // Back from Edit details / Apply payment / Add fee: show their notice, drop a stale
      // 'settle first' and any open fee confirmation.
      setLocalNotice(null);
      setEndError(null);
      setConfirmFee(null);
      setFeeError(null);
      load();
    }, [load])
  );

  // × on an applied extra fee, after confirming (rj t132u, migration 0063). If payments
  // then exceed what is due the balance goes negative (a credit, shown in red).
  const removeFee = async (chargeId: string) => {
    setFeeError(null);
    setRemoving(true);
    try {
      const { data, error: e } = await supabase.rpc('remove_session_fee', {
        p_session_id: id,
        p_charge_id: chargeId,
      });
      if (e || data?.error) {
        setFeeError(e?.message || walkInErrorMessage(data?.error));
        await load();
        return;
      }
      setConfirmFee(null);
      setEndError(null);
      setNotice(`Removed ${data.description} ${formatPeso(data.amount)}`);
      await load();
    } finally {
      setRemoving(false);
    }
  };

  // Refund on an ended session (0052): a cancelled reservation's deposits or an overpaid credit.
  const refund = async () => {
    setPayError(null);
    const bad = refundAmountError(payAmount, Number(d.refundable));
    if (bad) return setPayError(bad);
    setPaying(true);
    try {
      const { data, error: e } = await supabase.rpc('record_session_refund', {
        p_session_id: id,
        p_amount: Number(payAmount),
        p_method: payMethod,
        p_note: payNote.trim() || null,
      });
      if (e || data?.error) {
        setPayError(e?.message || walkInErrorMessage(data?.error, data?.refundable));
        return;
      }
      setNotice(`Refund of ${formatPeso(Number(payAmount))} recorded`);
      setPayAmount('');
      setPayNote('');
      await load();
    } finally {
      setPaying(false);
    }
  };

  const sessionParams = (extra?: Record<string, string>) => ({
    id: id!,
    locationId: d.session.location_id,
    ...(from ? { from } : {}),
    ...extra,
  });
  const openFee = () => router.push({ pathname: '/staff/session-fee', params: sessionParams() });
  const openEdit = () => router.push({ pathname: '/staff/session-edit', params: sessionParams() });
  // 'Apply payment of ₱X' passes X; the plain button prefills the whole balance.
  const openPay = (amount?: number) =>
    router.push({
      pathname: '/staff/session-pay',
      params: sessionParams(amount ? { amount: amount.toFixed(2) } : undefined),
    });

  const cancelReservation = async () => {
    setCancelError(null);
    setEnding(true);
    try {
      const { data, error: e } = await supabase.rpc('cancel_reservation_session', {
        p_session_id: id,
        p_reason: cancelReason.trim() || null,
      });
      if (e || data?.error) {
        setCancelError(e?.message || walkInErrorMessage(data.error));
        setCancelAttempt((n) => n + 1);
        await load();
        return;
      }
      router.dismissTo(
        sessionReturnRoute(from, {
          locationId: d.session.location_id,
          cancelled: d.session.plate,
        })
      );
    } finally {
      setEnding(false);
    }
  };

  const approve = async () => {
    setApproving(true);
    setError(null);
    try {
      const { data, error: e } = await supabase.rpc('approve_reservation', { p_session_id: id });
      if (e || data?.error) {
        setError(reservationErrorMessage(data?.error || e?.message));
        await load();
        return;
      }
      setNotice('Reservation approved');
      await load();
    } finally {
      setApproving(false);
    }
  };

  const reject = async () => {
    setRejecting(true);
    setError(null);
    try {
      const { data, error: e } = await supabase.rpc('reject_reservation', { p_session_id: id });
      if (e || data?.error) {
        setError(reservationErrorMessage(data?.error || e?.message));
        setRejectAttempt((n) => n + 1);
        await load();
        return;
      }
      setNotice('Reservation rejected');
      await load();
    } finally {
      setRejecting(false);
    }
  };

  const changeArea = async (areaId: string) => {
    if (!d || areaId === d.session.area_id) return;
    setAreaError(null);
    const { data, error: e } = await supabase.rpc('set_reservation_area', {
      p_session_id: id,
      p_area_id: areaId,
    });
    if (e || data?.error) {
      setAreaError(reservationErrorMessage(data?.error || e?.message));
      return;
    }
    setNotice('Area updated');
    await load();
  };

  const end = async (withWaiver: boolean) => {
    setEndError(null);
    setEnding(true);
    try {
      const { data, error: e } = await supabase.rpc('end_session', {
        p_session_id: id,
        p_waive_note: withWaiver ? waiveNote.trim() || null : null,
      });
      if (e) return setEndError({ text: e.message, balance: 0 });
      if (data?.error) {
        const bal = balanceToSettle(data.balance);
        setEndError({ text: walkInErrorMessage(data.error, data.balance), balance: bal });
        await load();
        return;
      }
      // Staff are pushed by the server (notifications trigger -> send-push), not from here.
      // Back to the Active Sessions screen already in the stack (or open it), not a
      // second copy on top.
      router.dismissTo(
        sessionReturnRoute(from, { locationId: d.session.location_id, ended: d.session.plate })
      );
    } finally {
      setEnding(false);
    }
  };

  if (!d) {
    return (
      <View style={[styles.container, styles.centered]} testID="session-loading">
        {error ? (
          <Text style={styles.error} testID="session-error">
            {error}
          </Text>
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  }

  const s = d.session;
  const ended = s.status === 'ended';
  // A future start is a reservation (0049): cancelled, not ended, before it starts.
  const reservation = !ended && !!s.reservation;
  const open = canEditSession(s);
  // Apply payment (only with a balance) and Add fee: above End session (rj t134u); a
  // reservation has no End, so they sit under Edit details there.
  const moneyButtons = open ? (
    <View style={styles.moneyRow} testID="session-money-actions">
      {canApplyPayment(s, d.balance) ? (
        <Button
          title="Apply payment"
          onPress={() => openPay()}
          testID="session-pay"
          style={styles.action}
        />
      ) : null}
      <Button
        title="Add fee"
        variant="outline"
        onPress={openFee}
        testID="session-add-fee"
        style={styles.action}
      />
    </View>
  ) : null;
  return (
    <ScrollView style={styles.container} contentContainerStyle={bottomInset} testID="session-ready">
      <View style={styles.header}>
        <Text style={styles.plate} testID="session-plate">
          {s.plate}
        </Text>
        <Text style={styles.headerMeta}>
          {VEHICLE_TYPE_LABELS[s.vehicle_type as VehicleType] || s.vehicle_type} · {s.location_name}
          {s.area_name ? ` (${s.area_name})` : ''} ·{' '}
          {s.approval_status === 'rejected'
            ? `Reservation rejected ${formatLocalDateTime(s.cancelled_at)}`
            : reservation && s.approval_status === 'pending'
              ? `For approval · starts ${formatLocalDateTime(s.started_at)} (${startsIn(s.started_at)})`
              : reservation
                ? `Reservation · starts ${formatLocalDateTime(s.started_at)} (${startsIn(s.started_at)})`
                : s.status === 'overdue'
                  ? 'Overdue'
                  : ended && s.cancelled_at
                    ? `Reservation cancelled ${formatLocalDateTime(s.cancelled_at)}`
                    : ended
                      ? `Ended ${formatLocalDateTime(s.ended_at)}`
                      : 'Active'}
        </Text>
      </View>

      <View style={styles.section} testID="session-balance-box">
        <Text style={styles.row}>
          {reservation ? 'Planned stay' : 'Parking'}: {formatPeso(d.parking)}
        </Text>
        {setRateLabel(s) ? (
          <Text style={styles.meta} testID="session-set-rate">
            Set rate: {setRateLabel(s)}
          </Text>
        ) : null}
        {priceBreakdownLines(d.price, s.set_rate_name).map((line, i) => (
          <Text key={i} style={styles.meta} testID={`session-part-${i}`}>
            {line}
          </Text>
        ))}
        {s.rate_changed_from?.name ? (
          <Text style={styles.rateChanged} testID="session-rate-changed">
            Rate changed from {s.rate_changed_from.name} (deactivated). Its hours are now priced by
            the active rates in effect.
          </Text>
        ) : null}
        <Text style={styles.meta} testID="session-price-detail">
          {reservation && !s.end_at
            ? `From ${formatLocalDateTime(s.started_at)} · minimum charge until an End is set`
            : d.price?.until_now
              ? `Up to now (${formatLocalDateTime(d.price.until)})`
              : `To ${formatLocalDateTime(d.price?.until)}`}
        </Text>
        {d.charges.length ? (
          <View testID="session-fees">
            <Text style={styles.row} testID="session-extra">
              Extra fees: {formatPeso(d.extra_fees)}
            </Text>
            {d.charges.map((c: any) => {
              const removable = open && c.type === 'additional_fee';
              return (
                <View key={c.id}>
                  <View style={styles.feeRow} testID={`fee-row-${c.description}`}>
                    <Text style={styles.feeText}>
                      {c.description}: {formatPeso(c.amount)}
                    </Text>
                    {removable ? (
                      <TouchableOpacity
                        onPress={() => {
                          setFeeError(null);
                          setConfirmFee(c.id);
                        }}
                        style={styles.feeX}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${c.description}`}
                        hitSlop={8}
                        testID={`fee-remove-${c.description}`}
                      >
                        <Text style={styles.feeXText}>×</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {confirmFee === c.id ? (
                    <View style={styles.feeConfirm} testID="fee-remove-confirm">
                      <Text style={styles.meta}>
                        Remove {c.description} {formatPeso(c.amount)} from this session?
                      </Text>
                      <View style={styles.confirmRow}>
                        <Button
                          title="Remove"
                          size="small"
                          variant="danger"
                          loading={removing}
                          onPress={() => removeFee(c.id)}
                          testID="fee-remove-yes"
                        />
                        <Button
                          title="Keep"
                          size="small"
                          variant="outline"
                          onPress={() => setConfirmFee(null)}
                          testID="fee-remove-no"
                        />
                      </View>
                      {feeError ? (
                        <Text style={styles.meta} testID="fee-remove-error">
                          {feeError}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
        {paymentsDisplay(d.payments) === 'collapsible' ? (
          <TouchableOpacity
            onPress={() => setShowPayments((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showPayments }}
            testID="session-paid-toggle"
          >
            <Text style={styles.row} testID="session-paid">
              {Number(d.refunded) > 0 ? 'Paid (net)' : 'Paid'}: {formatPeso(d.paid)}{' '}
              <Text style={styles.toggle}>
                {showPayments ? '▾ Hide' : `▸ ${d.payments.length} payments`}
              </Text>
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.row} testID="session-paid">
            {Number(d.refunded) > 0 ? 'Paid (net)' : 'Paid'}: {formatPeso(d.paid)}
          </Text>
        )}
        {paymentsDisplay(d.payments) === 'single' ||
        (paymentsDisplay(d.payments) === 'collapsible' && showPayments) ? (
          <View testID="session-payment-list">
            {d.payments.map((p: any, i: number) => (
              <Text
                key={p.id}
                style={[styles.paymentRow, p.direction === 'refund' && styles.refundRow]}
                testID={`payment-row-${i}`}
              >
                {p.direction === 'refund' ? 'Refund −' : ''}
                {formatPeso(p.amount)} ·{' '}
                {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] || p.method} ·{' '}
                {formatLocalDateTime(p.received_at)} · {p.recorded_by}
                {p.note ? ` · ${p.note}` : ''}
              </Text>
            ))}
          </View>
        ) : null}
        {Number(d.refunded) > 0 ? (
          <Text style={styles.meta} testID="session-refunded">
            Refunded: {formatPeso(d.refunded)}
          </Text>
        ) : null}
        {Number(d.waived) > 0 ? (
          <Text style={styles.waived} testID="session-waived">
            Waived: {formatPeso(d.waived)}
          </Text>
        ) : null}
        <Text
          style={[styles.balance, isNegativeBalance(d.balance) && styles.negative]}
          testID="session-balance"
        >
          Balance: {formatPeso(d.balance)}
        </Text>
      </View>

      {canEditSessionDetails(s) ? (
        <View style={styles.actions} testID="session-actions">
          <Button
            title="Edit details"
            variant="outline"
            onPress={openEdit}
            testID="session-edit"
            style={styles.action}
          />
        </View>
      ) : null}
      {open && reservation ? (
        <View style={{ marginHorizontal: theme.spacing.md }}>{moneyButtons}</View>
      ) : null}
      {notice ? (
        <Text
          style={[styles.notice, { marginHorizontal: theme.spacing.md }]}
          testID="session-notice"
        >
          {notice}
        </Text>
      ) : null}
      {ended && Number(d.refundable) > 0 ? (
        <View style={styles.section} testID="session-payments">
          <View testID="refund-box">
            <Text style={styles.label}>
              Refund (up to {formatPeso(d.refundable)}
              {s.cancelled_at ? ' paid on this cancelled reservation' : ' overpaid'})
            </Text>
            <TextInput
              style={styles.input}
              value={payAmount}
              onChangeText={setPayAmount}
              keyboardType="decimal-pad"
              placeholder={Number(d.refundable).toFixed(2)}
              testID="refund-amount"
            />
            <View style={styles.chips}>
              {PAYMENT_METHODS.map((m) => (
                <TouchableOpacity
                  key={m}
                  onPress={() => setPayMethod(m)}
                  style={[styles.chip, payMethod === m && styles.chipOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: payMethod === m }}
                  testID={`refund-method-${m}`}
                >
                  <Text style={[styles.chipText, payMethod === m && styles.chipTextOn]}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.input, { marginTop: theme.spacing.sm }]}
              value={payNote}
              onChangeText={setPayNote}
              placeholder="Note (optional), e.g. GCash ref"
              testID="refund-note"
            />
            {payError ? (
              <Text style={styles.error} testID="refund-error">
                {payError}
              </Text>
            ) : null}
            <Button
              title="Record refund"
              variant="outline"
              onPress={refund}
              loading={paying}
              testID="refund-submit"
              style={{ marginTop: theme.spacing.sm }}
            />
          </View>
        </View>
      ) : null}

      {reservation ? (
        <View style={styles.section} testID="reservation-area">
          <Text style={styles.heading}>Area</Text>
          <FilterDropdown
            label="Area"
            value={s.area_id}
            options={areas
              .filter((a) => a.id === s.area_id || areaAllowsVehicle(a, s.vehicle_type))
              .map((a) => ({ value: a.id, label: a.name }))}
            onChange={(value) => {
              if (value) changeArea(value);
            }}
            highlightActive={false}
            style={styles.areaDropdown}
            testID="reservation-area-picker"
          />
          {areaError ? (
            <Text style={styles.error} testID="reservation-area-error">
              {areaError}
            </Text>
          ) : null}
        </View>
      ) : null}

      {reservation && s.approval_status === 'pending' ? (
        <View style={styles.section} testID="reservation-approval">
          <Text style={styles.heading}>For approval</Text>
          {s.same_plate_overlap ? (
            <Text style={styles.error} testID="same-plate-overlap">
              This reservation overlaps another reservation for the same plate (
              {s.same_plate_overlap.plate}), so it can't be approved.
            </Text>
          ) : (
            <Button
              title="Approve"
              onPress={approve}
              loading={approving}
              testID="reservation-approve"
            />
          )}
          <View style={{ marginTop: theme.spacing.md }}>
            <SlideToConfirm
              label="Slide to reject"
              onConfirm={reject}
              loading={rejecting}
              resetKey={rejectAttempt}
              testID="reservation-reject"
            />
          </View>
        </View>
      ) : null}

      {reservation ? (
        <View style={styles.section} testID="reservation-cancel-box">
          <Button
            title="Cancel reservation"
            variant="danger"
            onPress={() => setCancelOpen(true)}
            testID="reservation-cancel"
          />
        </View>
      ) : null}
      <Modal
        visible={cancelOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!ending) setCancelOpen(false);
        }}
      >
        <View style={styles.backdrop}>
          <View style={styles.dialog} testID="reservation-cancel-dialog">
            <Text style={styles.dialogTitle}>Cancel this reservation?</Text>
            <Text style={styles.meta}>
              It hasn't started, so cancelling closes it with no parking fee. Payments already
              applied stay recorded.
            </Text>
            <TextInput
              style={styles.input}
              value={cancelReason}
              onChangeText={setCancelReason}
              placeholder="Reason (optional)"
              testID="cancel-reason"
            />
            {cancelError ? (
              <Text style={styles.error} testID="cancel-error">
                {cancelError}
              </Text>
            ) : null}
            <SlideToConfirm
              label="Slide to cancel"
              onConfirm={cancelReservation}
              loading={ending}
              resetKey={cancelAttempt}
              testID="reservation-cancel-slide"
            />
            <Button
              title="Keep it"
              variant="outline"
              onPress={() => setCancelOpen(false)}
              disabled={ending}
              testID="reservation-cancel-keep"
            />
          </View>
        </View>
      </Modal>

      {!ended && !reservation ? (
        <View style={styles.section} testID="session-end-box">
          <Text style={styles.heading}>End session</Text>
          <Text style={styles.meta}>
            The amount is worked out at the end time, or now if there is no end. Any balance must be
            settled first.
          </Text>
          {endError ? (
            <View testID="end-blocked">
              <Text style={styles.error}>{endError.text}</Text>
              {endError.balance > 0 ? (
                <Button
                  title={`Apply payment of ${formatPeso(endError.balance)}`}
                  size="small"
                  onPress={() => openPay(endError.balance)}
                  testID="end-pay-shortcut"
                />
              ) : null}
              {endError.balance > 0 && d.can_waive ? (
                <>
                  <TextInput
                    style={[styles.input, { marginTop: theme.spacing.sm }]}
                    value={waiveNote}
                    onChangeText={setWaiveNote}
                    placeholder="Or waive it: reason"
                    testID="waive-note"
                  />
                  <Button
                    title="Waive balance and end"
                    size="small"
                    variant="outline"
                    onPress={() => end(true)}
                    disabled={!waiveNote.trim()}
                    testID="waive-end"
                    style={{ marginTop: theme.spacing.sm }}
                  />
                </>
              ) : null}
            </View>
          ) : null}
          {moneyButtons}
          <Button
            title="End session"
            variant="danger"
            onPress={() => end(false)}
            loading={ending}
            testID="session-end"
            style={{ marginTop: theme.spacing.sm }}
          />
        </View>
      ) : null}

      {error ? (
        <Text style={styles.error} testID="session-error">
          {error}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  dialog: {
    backgroundColor: theme.colors.background,
    borderRadius: 16,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  dialogTitle: { ...theme.typography.h3, color: theme.colors.text.primary },
  areaDropdown: { maxWidth: '100%', alignSelf: 'flex-start', marginTop: theme.spacing.xs },
  refundRow: { color: theme.colors.danger },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.xs,
  },
  action: { flex: 1 },
  moneyRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginHorizontal: 0,
    marginTop: theme.spacing.sm,
  },
  feeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    paddingLeft: theme.spacing.sm,
  },
  feeText: { ...theme.typography.bodySmall, color: theme.colors.text.secondary, flex: 1 },
  feeX: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  feeXText: { fontSize: 16, lineHeight: 18, color: theme.colors.danger, fontWeight: '700' },
  feeConfirm: {
    marginTop: theme.spacing.xs,
    marginLeft: theme.spacing.sm,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.background,
  },
  toggle: { ...theme.typography.bodySmall, color: theme.colors.primary, fontWeight: '600' },
  paymentRow: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginTop: 2,
    paddingLeft: theme.spacing.sm,
  },
  confirmRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  centered: { alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  header: { padding: theme.spacing.lg, backgroundColor: theme.colors.primary },
  plate: { ...theme.typography.h2, color: '#fff' },
  headerMeta: { ...theme.typography.body, color: '#fff', opacity: 0.9 },
  section: {
    margin: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface,
  },
  heading: { ...theme.typography.h3 },
  label: {
    ...theme.typography.body,
    fontWeight: '600',
    marginTop: theme.spacing.md,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    fontSize: 16,
    backgroundColor: theme.colors.background,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { ...theme.typography.bodySmall },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  row: { ...theme.typography.body, marginTop: 4 },
  meta: { ...theme.typography.bodySmall, color: theme.colors.text.secondary, marginTop: 2 },
  waived: {
    ...theme.typography.body,
    color: theme.colors.warning,
    fontWeight: '700',
    marginTop: 4,
  },
  balance: { ...theme.typography.h3, color: theme.colors.primary, marginTop: theme.spacing.sm },
  negative: { color: theme.colors.danger },
  rateChanged: {
    ...theme.typography.bodySmall,
    color: '#92400e',
    backgroundColor: '#fef3c7',
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    marginVertical: theme.spacing.xs,
  },
  notice: { ...theme.typography.body, color: theme.colors.success, marginTop: theme.spacing.sm },
  error: { ...theme.typography.body, color: theme.colors.danger, margin: theme.spacing.md },
});
