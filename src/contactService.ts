import prisma from "./prisma";

// Mirror the Prisma enum values as plain constants
// so the code works even before `prisma generate` is run
const PRIMARY = "primary" as const;
const SECONDARY = "secondary" as const;
type LinkPrecedence = typeof PRIMARY | typeof SECONDARY;

// Shape of the input we receive from the request body
interface IdentifyInput {
  email?: string;
  phoneNumber?: string;
}

export async function identifyContact(input: IdentifyInput) {
  const { email, phoneNumber } = input;

  // ---------------------------------------------------------------
  // Step 1: Find all contacts that directly match the email or phone
  // ---------------------------------------------------------------
  const directMatches = await prisma.contact.findMany({
    where: {
      OR: [email ? { email } : {}, phoneNumber ? { phoneNumber } : {}],
      deletedAt: null,
    },
  });

  // ---------------------------------------------------------------
  // Step 2: If no contacts found at all, create a new primary contact
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
  // Step 3: Gather all primary IDs related to matched contacts.
  // A matched contact can itself be a primary, or it can be a
  // secondary that points to a primary via linkedId.
  // ---------------------------------------------------------------
  const primaryIds = new Set<number>();

  for (const contact of directMatches) {
    if (contact.linkPrecedence === PRIMARY) {
      primaryIds.add(contact.id);
    } else if (contact.linkedId !== null) {
      // This is a secondary — its parent primary is linkedId
      primaryIds.add(contact.linkedId);
    }
  }

  // ---------------------------------------------------------------
  // Step 4: Fetch all contacts belonging to these primary groups.
  // This gives us the full picture: all primaries + their secondaries.
  // ---------------------------------------------------------------
  const allRelatedContacts = await prisma.contact.findMany({
    where: {
      OR: [
        { id: { in: [...primaryIds] } },
        { linkedId: { in: [...primaryIds] } },
      ],
      deletedAt: null,
    },
    orderBy: {
      createdAt: "asc", // oldest first — important for picking the true primary
    },
  });

  // ---------------------------------------------------------------
  // Step 5: From all related contacts, find the oldest primary.
  // That will be the one true primary for this identity cluster.
  // ---------------------------------------------------------------
  const allPrimaries = allRelatedContacts.filter(
    (c) => c.linkPrecedence === PRIMARY,
  );

  // The oldest primary is the first one (sorted by createdAt asc)
  const oldestPrimary = allPrimaries[0];

  // ---------------------------------------------------------------
  // Step 6: If there are multiple primaries, convert all newer ones
  // to secondary and link them to the oldest primary.
  // This happens when two separate clusters get connected together.
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

  // Also update any secondaries that were pointing to a now-demoted primary
  // so they all point to the true oldest primary
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
  // Step 7: Re-fetch the full updated cluster after all changes above
  // ---------------------------------------------------------------
  const finalContacts = await prisma.contact.findMany({
    where: {
      OR: [{ id: oldestPrimary.id }, { linkedId: oldestPrimary.id }],
      deletedAt: null,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  // ---------------------------------------------------------------
  // Step 8: Check if the incoming email or phone is new (not seen in
  // any existing contact). If yes, create a new secondary contact.
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

    // Re-fetch one more time to include the newly created secondary
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
  // Step 9: Build and return the final response
  // ---------------------------------------------------------------
  return buildResponse(oldestPrimary.id, finalContacts);
}

// Helper to build the response object from a list of contacts.
// Primary contact's email and phone always appear first.
// Sets are used to track seen values and prevent duplicates.
function buildResponse(
  primaryId: number,
  contacts: Array<{
    id: number;
    email: string | null;
    phoneNumber: string | null;
    linkPrecedence: LinkPrecedence;
  }>,
) {
  const emails: string[] = [];
  const phoneNumbers: string[] = [];
  const secondaryContactIds: number[] = [];

  // Use Sets to efficiently track what has already been added
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();

  // Find the primary contact from the list
  const primary = contacts.find((c) => c.id === primaryId);

  // Add primary's email and phone first so they appear at index 0
  if (primary?.email) {
    emails.push(primary.email);
    seenEmails.add(primary.email);
  }
  if (primary?.phoneNumber) {
    phoneNumbers.push(primary.phoneNumber);
    seenPhones.add(primary.phoneNumber);
  }

  // Now loop through all contacts and add secondary data
  for (const contact of contacts) {
    // Skip the primary — already handled above
    if (contact.id === primaryId) continue;

    // All non-primary contacts are secondaries
    secondaryContactIds.push(contact.id);

    // Add email if not already in the list
    if (contact.email && !seenEmails.has(contact.email)) {
      emails.push(contact.email);
      seenEmails.add(contact.email);
    }

    // Add phone number if not already in the list
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
