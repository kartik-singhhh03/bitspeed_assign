import prisma from "./prisma";
import { LinkPrecedence } from "@prisma/client";

// Shape of the input we receive from the request body
interface IdentifyInput {
  email?: string;
  phoneNumber?: string;
}

export async function identifyContact(input: IdentifyInput) {
  const { email, phoneNumber } = input;

  // Step 1: Find all contacts that match the given email OR phoneNumber
  const matchedContacts = await prisma.contact.findMany({
    where: {
      OR: [
        email ? { email } : {},
        phoneNumber ? { phoneNumber } : {},
      ],
      deletedAt: null, // ignore soft-deleted contacts
    },
    orderBy: {
      createdAt: "asc", // oldest first
    },
  });

  // Step 2: If no contacts found, create a brand new primary contact
  if (matchedContacts.length === 0) {
    const newContact = await prisma.contact.create({
      data: {
        email: email ?? null,
        phoneNumber: phoneNumber ?? null,
        linkPrecedence: LinkPrecedence.primary,
      },
    });

    // Return the newly created contact as the primary
    return {
      primaryContactId: newContact.id,
      emails: newContact.email ? [newContact.email] : [],
      phoneNumbers: newContact.phoneNumber ? [newContact.phoneNumber] : [],
      secondaryContactIds: [],
    };
  }

  // Step 3: Contacts found — use the first (oldest) one as primary for now
  // Merging logic will be added in the next level
  const primary = matchedContacts[0];

  // Collect all unique emails and phone numbers from matched contacts
  const emails = [...new Set(matchedContacts.map((c) => c.email).filter(Boolean))] as string[];
  const phoneNumbers = [...new Set(matchedContacts.map((c) => c.phoneNumber).filter(Boolean))] as string[];

  // Collect IDs of contacts that are not the primary
  const secondaryContactIds = matchedContacts
    .filter((c) => c.id !== primary.id)
    .map((c) => c.id);

  return {
    primaryContactId: primary.id,
    emails,
    phoneNumbers,
    secondaryContactIds,
  };
}
