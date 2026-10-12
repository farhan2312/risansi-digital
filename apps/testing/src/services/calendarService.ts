import apiClient from "./apiClient";
import type { CalendarEcOption, CalendarEvent, CalendarRequisitionOption, NewCalendarEventInput } from "../types/testing";

/** Every event in range (inclusive) -- omit both for everything. Everyone signed in can call this;
 * only Admin can create/update/delete (see below). */
export const listCalendarEvents = async (range?: { from?: string; to?: string }): Promise<CalendarEvent[]> => {
  const { data } = await apiClient.get<CalendarEvent[]>("/calendar-events", { params: range });
  return data;
};

export const createCalendarEvent = async (input: NewCalendarEventInput): Promise<CalendarEvent> => {
  const { data } = await apiClient.post<CalendarEvent>("/calendar-events", input);
  return data;
};

export const updateCalendarEvent = async (id: string, patch: Partial<NewCalendarEventInput>): Promise<CalendarEvent> => {
  const { data } = await apiClient.patch<CalendarEvent>(`/calendar-events/${id}`, patch);
  return data;
};

export const deleteCalendarEvent = async (id: string): Promise<void> => {
  await apiClient.delete(`/calendar-events/${id}`);
};

/** Every requisition number the caller may see, for the New Event form's Requisition No. search. */
export const listCalendarRequisitionOptions = async (): Promise<CalendarRequisitionOption[]> => {
  const { data } = await apiClient.get<CalendarRequisitionOption[]>("/calendar-events/requisition-options");
  return data;
};

/** Every EC/Quotation No. on record, for the New Event form's search field. */
export const listCalendarEcOptions = async (): Promise<CalendarEcOption[]> => {
  const { data } = await apiClient.get<CalendarEcOption[]>("/calendar-events/ec-options");
  return data;
};
