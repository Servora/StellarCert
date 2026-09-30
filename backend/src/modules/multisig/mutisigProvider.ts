import { Injectable } from '@nestjs/common';

export enum RequestStatus {
  Pend = 0,
  Approve = 1,
  Reject = 2,
  Expir = 3,
  Issue = 4,
}

export enum SignatureAction {
  Approv = 0,
  Reject = 1,
}


 @Injectable()
 export class MultisigProveider{


    async MultiSigProvider () {
        
    }



 }