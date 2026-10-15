import type { Appointment, CommercialEvent, Conversation, Message } from "./domain/entities.js";
import { AppointmentStatus, CommercialEventType, CommercialOutcome, OutboundDeliveryStatus, SenderType } from "./domain/enums.js";
import type { AppointmentRepository, CommercialEventRepository, ConversationRepository, MessageRepository, OutboundDeliveryRepository, QuoteRequestRepository } from "./repositories.js";

export class ConfirmAppointmentError extends Error {
  constructor(public readonly code: "APPOINTMENT_NOT_FOUND" | "APPOINTMENT_NOT_REQUESTED" | "APPOINTMENT_ALREADY_CONFIRMED" | "APPOINTMENT_SELECTION_STALE" | "INVALID_APPOINTMENT_DATETIME", message: string = code) {
    super(message);
  }
}

export type ConfirmAppointmentInput = {
  businessId: string;
  appointmentId: string;
  conversationId: string;
  quoteRequestId: string;
  expectedAppointmentUpdatedAt: string;
  date: string;
  time: string;
};

export type ConfirmAppointmentDependencies = {
  appointmentRepository: AppointmentRepository;
  conversationRepository: ConversationRepository;
  quoteRequestRepository: QuoteRequestRepository;
  messageRepository: MessageRepository;
  outboundDeliveryRepository: OutboundDeliveryRepository;
  commercialEventRepository?: CommercialEventRepository;
  now: () => string;
  generateId: (prefix: string) => string;
};

export async function confirmAppointment(input: ConfirmAppointmentInput, dependencies: ConfirmAppointmentDependencies) {
  if (!isValidDate(input.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) {
    throw new ConfirmAppointmentError("INVALID_APPOINTMENT_DATETIME");
  }
  const appointment = await dependencies.appointmentRepository.findById(input.businessId, input.appointmentId);
  if (appointment === null) throw new ConfirmAppointmentError("APPOINTMENT_NOT_FOUND");
  const quote = await dependencies.quoteRequestRepository.findById(input.businessId, input.quoteRequestId);
  if (quote === null || quote.businessId !== input.businessId || quote.conversationId !== appointment.conversationId || quote.authorizedPrice === undefined) {
    throw new ConfirmAppointmentError("APPOINTMENT_SELECTION_STALE", "Appointment selection is stale");
  }
  if (appointment.conversationId !== input.conversationId || appointment.updatedAt !== input.expectedAppointmentUpdatedAt) {
    throw new ConfirmAppointmentError("APPOINTMENT_SELECTION_STALE", "Appointment selection is stale");
  }
  if (appointment.status === AppointmentStatus.CONFIRMED) {
    if (appointment.requestedDate !== input.date || appointment.requestedTime !== input.time) {
      throw new ConfirmAppointmentError("APPOINTMENT_ALREADY_CONFIRMED");
    }
  } else if (appointment.status !== AppointmentStatus.REQUESTED) {
    throw new ConfirmAppointmentError("APPOINTMENT_NOT_REQUESTED");
  }

  const conversation = await dependencies.conversationRepository.findById(input.businessId, appointment.conversationId);
  if (conversation === null) throw new ConfirmAppointmentError("APPOINTMENT_NOT_FOUND");
  const content = `Agendamento confirmado para ${formatDate(input.date)} às ${input.time}.`;
  const now = dependencies.now();
  const currentDelivery = await dependencies.outboundDeliveryRepository.findByAppointmentAndChannel(input.businessId, appointment.id, conversation.channel);
  const reservation = currentDelivery === null
    ? await dependencies.outboundDeliveryRepository.reserve({
        id: dependencies.generateId("outbound-delivery"),
        businessId: input.businessId,
        appointmentId: appointment.id,
        conversationId: conversation.id,
        channel: conversation.channel,
        status: OutboundDeliveryStatus.PENDING,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      })
    : { created: false, delivery: currentDelivery };
  const delivery = reservation.delivery;

  let messageId = delivery.messageId;
  if (messageId === undefined) {
    const updatedAppointment: Appointment = {
      ...appointment,
      requestedDate: input.date,
      requestedTime: input.time,
      confirmedStartAt: `${input.date}T${input.time}:00`,
      status: AppointmentStatus.CONFIRMED,
      updatedAt: now,
    };
    await dependencies.appointmentRepository.save(updatedAppointment);
    const message: Message = {
      id: dependencies.generateId("message"),
      businessId: input.businessId,
      conversationId: conversation.id,
      senderType: SenderType.ASSISTANT,
      channel: conversation.channel,
      content,
      createdAt: now,
    };
    await dependencies.messageRepository.save(message);
    await dependencies.outboundDeliveryRepository.attachMessage(input.businessId, delivery.id, message.id, now);
    messageId = message.id;
    if (dependencies.commercialEventRepository !== undefined) {
      const event: CommercialEvent = {
        id: dependencies.generateId("commercial-event"),
        businessId: input.businessId,
        eventType: CommercialEventType.APPOINTMENT_CONFIRMED,
        conversationId: conversation.id,
        ...(appointment.customerId === undefined ? {} : { customerId: appointment.customerId }),
        ...(appointment.vehicleId === undefined ? {} : { vehicleId: appointment.vehicleId }),
        ...(appointment.opportunityId === undefined ? {} : { opportunityId: appointment.opportunityId }),
        quoteRequestId: input.quoteRequestId,
        channel: conversation.channel,
        ...(conversation.currentIntent === undefined ? {} : { intent: conversation.currentIntent }),
        commercialOutcome: CommercialOutcome.APPOINTMENT_CONFIRMED,
        ...(appointment.requestDescription === undefined ? {} : { requestedItem: appointment.requestDescription }),
        amount: quote.authorizedPrice,
        occurredAt: now,
      };
      await dependencies.commercialEventRepository.append(event);
    }
    await dependencies.conversationRepository.save({
      ...conversation,
      commercialOutcome: CommercialOutcome.APPOINTMENT_CONFIRMED,
      lastMessageAt: now,
    });
  }

  return { appointment: await dependencies.appointmentRepository.findById(input.businessId, appointment.id), messageId, content, delivery };
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
