import prisma from "./prisma";

// Use plain string constants instead of importing the Prisma enum.
// This keeps the file working even before `prisma generate` is run.
const PRIMARY = "primary" as const;
const SECONDARY = "secondary" as const;
type LinkPrecedence = typeof PRIMARY | typeof SECONDARY;

// Shape of what the controller sends us
export interface IdentifyInput {
  email?: string;
  phoneNumber?: string;
}

// Shape of what we return to the controller
export interface IdentifyResult {
  primaryContactId: number;
  emails: string[];
  phoneNumbers: string[];
  secondaryContactIds: number[];
}

export async function identifyContact(
  input: IdentifyInput,
): Promise<IdentifyResult> {
  const { email, phoneNumber } = input;

  // ---------------------------------------------------------------
  // Step 1: Find contacts that directly match the given email or phone
  // ---------------------------------------------------------------
  const directMatches = await prisma.contact.findMany({
    where: {
      OR: [email ? { email } : {}, phoneNumber ? { phoneNumber } : {}],
      deletedAt: null,
    },
  });

  // ---------------------------------------------------------------
  // Step 2: No matches at all — create a brand new primary contact
  // ---------------------------------------------------------------
  if (directMatches.length === 0) {
    const newContact = await prisma.contact.create({
      data: {
        email: email ?? null,
        phoneNumber: phoneNumber ?? null,
        linkPrecedence: PRIMARY,
      },
    });

    return {
      primaryContactId: newContact.id,
      emails: newContact.email ? [newContact.email] : [],
      phoneNumbers: newContact.phoneNumber ? [newContact.phoneNumber] : [],
      secondaryContactIds: [],
    };
  }

  // ---------------------------------------------------------------
  // Step 3: Collect all the primary IDs tied to the matched contacts.
  // A match can be a primary itself, or a secondary pointing to one.
  // ---------------------------------------------------------------
  const primaryIds = new Set<number>();

  for (const contact of directMatches) {
    if (contact.linkPrecedence === PRIMARY) {
      primaryIds.add(contact.id);
    } else if (contact.linkedId !== null) {
      primaryIds.add(contact.linkedId);
    }
  }

  // ---------------------------------------------------------------
  // Step 4: Load the full cluster — all primaries and their secondaries
  // ---------------------------------------------------------------
  const allRelatedContacts = await prisma.contact.findMany({
    where: {
      OR: [
        { id: { in: [...primaryIds] } },
        { linkedId: { in: [...primaryIds] } },
      ],
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" }, // oldest contact comes first
  });

  // ---------------------------------------------------------------
  // Step 5: Pick the oldest primary — this is the true master contact
  // ---------------------------------------------------------------
  const allPrimaries = allRelatedContacts.filter(
    (c) => c.linkPrecedence === PRIMARY,
  );

  const oldestPrimary = allPrimaries[0];

  // ---------------------------------------------------------------
  // Step 6: Demote any newer primaries to secondary.
  // This happens when two previously separate clusters get linked.
  // ---------------------------------------------------------------
  for (const primary of allPrimaries) {
    if (primary.id !== oldestPrimary.id) {
      await prisma.contact.update({
        where: { id: primary.id },
        data: {
          linkPrecedence: SECONDARY,
          linkedId: oldestPrimary.id,
        },
      });
    }
  }

  // Fix any secondaries that were pointing at a now-demoted primary
  for (const contact of allRelatedContacts) {
    if (
      contact.linkPrecedence === SECONDARY &&
      contact.linkedId !== oldestPrimary.id
    ) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { linkedId: oldestPrimary.id },
      });
    }
  }

  // ---------------------------------------------------------------
  // Step 7: Re-fetch the cluster now that all updates are done
  // ---------------------------------------------------------------
  const finalContacts = await prisma.contact.findMany({
    where: {
      OR: [{ id: oldestPrimary.id }, { linkedId: oldestPrimary.id }],
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" },
  });

  // ---------------------------------------------------------------
  // Step 8: If the incoming request has a new email or phone that
  // doesn't exist in the cluster yet, create a new secondary contact
  // ---------------------------------------------------------------
  const existingEmails = finalContacts.map((c) => c.email);
  const existingPhones = finalContacts.map((c) => c.phoneNumber);

  const isNewEmail = email && !existingEmails.includes(email);
  const isNewPhone = phoneNumber && !existingPhones.includes(phoneNumber);

  if (isNewEmail || isNewPhone) {
    await prisma.contact.create({
      data: {
        email: email ?? null,
        phoneNumber: phoneNumber ?? null,
        linkedId: oldestPrimary.id,
        linkPrecedence: SECONDARY,
      },
    });

    // Re-fetch one last time to include the new secondary
    const updatedContacts = await prisma.contact.findMany({
      where: {
        OR: [{ id: oldestPrimary.id }, { linkedId: oldestPrimary.id }],
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
    });

    return buildResponse(oldestPrimary.id, updatedContacts);
  }

  // ---------------------------------------------------------------
  // Step 9: Build and return the final formatted response
  // ---------------------------------------------------------------
  return buildResponse(oldestPrimary.id, finalContacts);
}

// Formats the contact list into the required API response shape.
// Primary's email and phone always appear first. No duplicates.
function buildResponse(
  primaryId: number,
  contacts: Array<{
    id: number;
    email: string | null;
    phoneNumber: string | null;
    linkPrecedence: LinkPrecedence;
  }>,
): IdentifyResult {
  const emails: string[] = [];
  const phoneNumbers: string[] = [];
  const secondaryContactIds: number[] = [];

  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();

  // Add primary's data first so it appears at index 0
  const primary = contacts.find((c) => c.id === primaryId);

  if (primary?.email) {
    emails.push(primary.email);
    seenEmails.add(primary.email);
  }
  if (primary?.phoneNumber) {
    phoneNumbers.push(primary.phoneNumber);
    seenPhones.add(primary.phoneNumber);
  }

  // Add each secondary's data, skipping any duplicates
  for (const contact of contacts) {
    if (contact.id === primaryId) continue;

    secondaryContactIds.push(contact.id);

    if (contact.email && !seenEmails.has(contact.email)) {
      emails.push(contact.email);
      seenEmails.add(contact.email);
    }

    if (contact.phoneNumber && !seenPhones.has(contact.phoneNumber)) {
      phoneNumbers.push(contact.phoneNumber);
      seenPhones.add(contact.phoneNumber);
    }
  }

  return {
    primaryContactId: primaryId,
    emails,
    phoneNumbers,
    secondaryContactIds,
  };
}
